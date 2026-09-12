import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../test/postgres'
import type { Viewer } from './articles'

/**
 * The forum against a real PostgreSQL.
 *
 * What is tested here is what lives in SQL and in the rules around it: that the
 * discussion inherits the article's visibility, that a reply cannot be nested
 * two deep or moved to another article's thread, that hiding a post writes the
 * reason in the same transaction as the status, and that a hidden post reaches
 * a poller that already had it. A mock would agree with whatever the code did.
 */

let harness: TestDatabase
let forum: typeof import('./forum')
let articles: typeof import('./articles')
let schema: typeof import('./db/schema')

beforeAll(async () => {
  harness = await startTestDatabase()
  process.env.DATABASE_URL = harness.url
  forum = await import('./forum')
  articles = await import('./articles')
  schema = await import('./db/schema')
})

afterAll(async () => {
  await harness?.stop()
})

beforeEach(async () => {
  await harness.db.delete(schema.forumModeration)
  await harness.db.delete(schema.forumPost)
  await harness.db.delete(schema.articleRevision)
  await harness.db.delete(schema.articleTranslation)
  await harness.db.delete(schema.article)
  await harness.db.delete(schema.user)
})

async function makeUser(
  role: string = 'reader',
  memberStatus: string = 'active',
): Promise<Viewer> {
  const id = randomUUID()
  await harness.db.insert(schema.user).values({
    id,
    name: `${role}-${id.slice(0, 4)}`,
    email: `${id}@kle.ht`,
    emailVerified: true,
    role: role as 'reader',
    memberStatus: memberStatus as 'active',
  })
  return { id, role: role as Viewer['role'], memberStatus }
}

const SUMMARY = 'Un diagnostic de la crise et les réponses que le mouvement propose.'

/** A published article, which is the only kind that has a discussion. */
async function publishedArticle(
  title = 'La situation économique en Haïti',
  visibility: 'public' | 'members' = 'public',
): Promise<string> {
  const author = await makeUser('member')
  const senior = await makeUser('senior_member')
  const created = await articles.createArticle({
    author,
    lang: 'fr',
    title,
    summary: SUMMARY,
    visibility,
  })
  if (!created.ok) throw new Error(`createArticle failed: ${created.code}`)

  const saved = await articles.saveTranslation({
    actor: author,
    articleId: created.value.articleId,
    lang: 'fr',
    title,
    summary: SUMMARY,
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Le diagnostic.' }] },
      ],
    },
  })
  if (!saved.ok) throw new Error(`saveTranslation failed: ${saved.code}`)

  const published = await articles.publishTranslation({
    actor: senior,
    articleId: created.value.articleId,
    lang: 'fr',
  })
  if (!published.ok) throw new Error(`publishTranslation failed: ${published.code}`)

  return created.value.slug
}

const RATIONALE = 'Attaque personnelle contre un autre membre du mouvement.'

describe('who may take part', () => {
  it('lets a reader post, which is what the reader tier is for', async () => {
    const slug = await publishedArticle()
    const reader = await makeUser('reader')

    const posted = await forum.createPost({
      actor: reader,
      slug,
      lang: 'fr',
      body: 'Le diagnostic me paraît juste, mais il manque la question agricole.',
    })

    expect(posted.ok).toBe(true)
    const thread = await forum.getDiscussion({ slug, viewer: reader })
    expect(thread.ok && thread.value.posts).toHaveLength(1)
    expect(thread.ok && thread.value.canPost).toBe(true)
  })

  it('lets anyone read a public discussion with no account', async () => {
    const slug = await publishedArticle()
    const reader = await makeUser('reader')
    await forum.createPost({ actor: reader, slug, lang: 'fr', body: 'Bien vu.' })

    const thread = await forum.getDiscussion({ slug, viewer: null })

    // Reach is the point: reading must never require an account (D1).
    expect(thread.ok && thread.value.posts).toHaveLength(1)
    // But an anonymous reader is told plainly that they cannot answer.
    expect(thread.ok && thread.value.canPost).toBe(false)
  })

  it('refuses a blocked account, and does so without a session', async () => {
    const slug = await publishedArticle()
    const blocked = await makeUser('member', 'blocked')

    const posted = await forum.createPost({
      actor: blocked,
      slug,
      lang: 'fr',
      body: "Quelque chose que ce compte n'a plus le droit de dire ici.",
    })

    expect(posted).toEqual({ ok: false, code: 'FORBIDDEN' })
  })

  it('hides a members-only discussion from an anonymous reader', async () => {
    const slug = await publishedArticle('Note interne du cercle économie', 'members')
    const member = await makeUser('member')
    await forum.createPost({ actor: member, slug, lang: 'fr', body: 'Note de travail.' })

    // The replies quote the article. A forum that answered here would be a way
    // around the article's own visibility.
    const anonymous = await forum.getDiscussion({ slug, viewer: null })
    expect(anonymous).toEqual({ ok: false, code: 'FORBIDDEN' })

    const reader = await makeUser('reader')
    const signedIn = await forum.getDiscussion({ slug, viewer: reader })
    expect(signedIn.ok && signedIn.value.posts).toHaveLength(1)
  })

  it('has no discussion under an article that is not published', async () => {
    const author = await makeUser('member')
    const created = await articles.createArticle({
      author,
      lang: 'fr',
      title: 'Un brouillon qui ne regarde personne',
      summary: SUMMARY,
    })
    if (!created.ok) throw new Error('setup failed')

    const thread = await forum.getDiscussion({ slug: created.value.slug, viewer: author })
    expect(thread).toEqual({ ok: false, code: 'NOT_FOUND' })
  })
})

describe('replies', () => {
  it('attaches a reply to a reply onto the post it is under', async () => {
    const slug = await publishedArticle()
    const a = await makeUser('reader')
    const b = await makeUser('reader')

    const root = await forum.createPost({
      actor: a,
      slug,
      lang: 'fr',
      body: 'Le point 3.',
    })
    if (!root.ok) throw new Error('setup failed')

    const reply = await forum.createPost({
      actor: b,
      slug,
      lang: 'ht',
      body: 'Mwen pa dakò ak pwen sa a.',
      parentId: root.value.id,
    })
    if (!reply.ok) throw new Error('setup failed')

    const deeper = await forum.createPost({
      actor: a,
      slug,
      lang: 'fr',
      body: 'Pourquoi pas ? Le chiffre vient du rapport.',
      parentId: reply.value.id,
    })

    // One level deep, and the person who pressed reply is not told off for it.
    expect(deeper.ok && deeper.value.parentId).toBe(root.value.id)
  })

  it('refuses a reply aimed at another article thread', async () => {
    const here = await publishedArticle('La situation économique en Haïti')
    const elsewhere = await publishedArticle("L'éducation comme priorité")
    const reader = await makeUser('reader')

    const other = await forum.createPost({
      actor: reader,
      slug: elsewhere,
      lang: 'fr',
      body: "Un message dans l'autre discussion.",
    })
    if (!other.ok) throw new Error('setup failed')

    const moved = await forum.createPost({
      actor: reader,
      slug: here,
      lang: 'fr',
      body: 'Une réponse qui déménage la conversation.',
      parentId: other.value.id,
    })

    expect(moved).toEqual({ ok: false, code: 'NOT_FOUND' })
  })
})

describe('taking a post back', () => {
  it('lets the author withdraw their own post and nobody else', async () => {
    const slug = await publishedArticle()
    const author = await makeUser('reader')
    const other = await makeUser('reader')
    const post = await forum.createPost({
      actor: author,
      slug,
      lang: 'fr',
      body: "Quelque chose que je regrette d'avoir écrit.",
    })
    if (!post.ok) throw new Error('setup failed')

    expect(await forum.withdrawPost({ actor: other, postId: post.value.id })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    })

    const withdrawn = await forum.withdrawPost({ actor: author, postId: post.value.id })
    expect(withdrawn.ok).toBe(true)

    // The row stays — a thread that loses a post lies to the people who
    // answered it — but the text stops being served.
    const thread = await forum.getDiscussion({ slug, viewer: null })
    expect(thread.ok && thread.value.posts).toHaveLength(1)
    expect(thread.ok && thread.value.posts[0].status).toBe('withdrawn')
    expect(thread.ok && thread.value.posts[0].body).toBeNull()
  })
})

describe('moderation', () => {
  it('hides a post and records why, in one transaction', async () => {
    const slug = await publishedArticle()
    const reader = await makeUser('reader')
    const senior = await makeUser('senior_member')
    const post = await forum.createPost({
      actor: reader,
      slug,
      lang: 'fr',
      body: 'Un message qui vise une personne plutôt que son argument.',
    })
    if (!post.ok) throw new Error('setup failed')

    const hidden = await forum.moderatePost({
      actor: senior,
      postId: post.value.id,
      hidden: true,
      rationale: RATIONALE,
    })
    expect(hidden.ok).toBe(true)

    const asReader = await forum.getDiscussion({ slug, viewer: reader })
    expect(asReader.ok && asReader.value.posts[0].status).toBe('hidden')
    expect(asReader.ok && asReader.value.posts[0].body).toBeNull()

    // A moderator keeps the text: restoring a post you cannot read is a
    // decision taken blind.
    const asModerator = await forum.getDiscussion({ slug, viewer: senior })
    expect(asModerator.ok && asModerator.value.posts[0].body).toContain(
      'vise une personne',
    )

    const log = await harness.db
      .select()
      .from(schema.forumModeration)
      .where(eq(schema.forumModeration.postId, post.value.id))
    expect(log).toHaveLength(1)
    expect(log[0].rationale).toBe(RATIONALE)
    expect(log[0].actorId).toBe(senior.id)
  })

  it('refuses a moderation with no real reason, and writes nothing', async () => {
    const slug = await publishedArticle()
    const reader = await makeUser('reader')
    const senior = await makeUser('senior_member')
    const post = await forum.createPost({
      actor: reader,
      slug,
      lang: 'fr',
      body: 'Un message parfaitement ordinaire.',
    })
    if (!post.ok) throw new Error('setup failed')

    const refused = await forum.moderatePost({
      actor: senior,
      postId: post.value.id,
      hidden: true,
      rationale: 'non',
    })

    expect(refused).toEqual({ ok: false, code: 'RATIONALE_REQUIRED' })
    expect(await harness.db.select().from(schema.forumModeration)).toHaveLength(0)
    const thread = await forum.getDiscussion({ slug, viewer: null })
    expect(thread.ok && thread.value.posts[0].status).toBe('visible')
  })

  it('does not let a member moderate', async () => {
    const slug = await publishedArticle()
    const reader = await makeUser('reader')
    const member = await makeUser('member')
    const post = await forum.createPost({
      actor: reader,
      slug,
      lang: 'fr',
      body: 'Un message ordinaire, encore.',
    })
    if (!post.ok) throw new Error('setup failed')

    expect(
      await forum.moderatePost({
        actor: member,
        postId: post.value.id,
        hidden: true,
        rationale: RATIONALE,
      }),
    ).toEqual({ ok: false, code: 'FORBIDDEN' })
  })

  it('will not overrule an author who withdrew their own post', async () => {
    const slug = await publishedArticle()
    const author = await makeUser('reader')
    const senior = await makeUser('senior_member')
    const post = await forum.createPost({
      actor: author,
      slug,
      lang: 'fr',
      body: 'Un message que son auteur retire ensuite.',
    })
    if (!post.ok) throw new Error('setup failed')
    await forum.withdrawPost({ actor: author, postId: post.value.id })

    const restored = await forum.moderatePost({
      actor: senior,
      postId: post.value.id,
      hidden: false,
      rationale: RATIONALE,
    })

    expect(restored).toEqual({ ok: false, code: 'ALREADY_IN_STATE' })
  })
})

describe('what the poller asks for', () => {
  it('returns a post that was hidden, not only posts that are new', async () => {
    const slug = await publishedArticle()
    const reader = await makeUser('reader')
    const senior = await makeUser('senior_member')
    const post = await forum.createPost({
      actor: reader,
      slug,
      lang: 'fr',
      body: 'Un message déjà affiché dans tous les onglets ouverts.',
    })
    if (!post.ok) throw new Error('setup failed')

    // What an open tab already has: everything up to now.
    const seen = new Date()
    await new Promise((resolve) => setTimeout(resolve, 10))

    await forum.moderatePost({
      actor: senior,
      postId: post.value.id,
      hidden: true,
      rationale: RATIONALE,
    })

    // Polling on `created_at` would return nothing here, and the post would
    // stay on screen in every tab that had it — which is the case moderation
    // exists for.
    const delta = await forum.getDiscussion({ slug, viewer: reader, since: seen })
    expect(delta.ok && delta.value.posts).toHaveLength(1)
    expect(delta.ok && delta.value.posts[0].status).toBe('hidden')
  })

  it('returns nothing when nothing has changed', async () => {
    const slug = await publishedArticle()
    const reader = await makeUser('reader')
    await forum.createPost({ actor: reader, slug, lang: 'fr', body: 'Un seul message.' })

    const delta = await forum.getDiscussion({ slug, viewer: reader, since: new Date() })
    expect(delta.ok && delta.value.posts).toHaveLength(0)
  })
})

describe('the tail on the article page', () => {
  it('counts only what is visible and shows the newest last', async () => {
    const slug = await publishedArticle()
    const reader = await makeUser('reader')
    const senior = await makeUser('senior_member')

    const first = await forum.createPost({
      actor: reader,
      slug,
      lang: 'fr',
      body: 'Premier message.',
    })
    await forum.createPost({ actor: reader, slug, lang: 'fr', body: 'Deuxième message.' })
    const third = await forum.createPost({
      actor: reader,
      slug,
      lang: 'fr',
      body: 'Troisième message.',
    })
    if (!first.ok || !third.ok) throw new Error('setup failed')

    await forum.moderatePost({
      actor: senior,
      postId: first.value.id,
      hidden: true,
      rationale: RATIONALE,
    })

    const thread = await forum.getDiscussion({ slug, viewer: null })
    const articleId = thread.ok ? thread.value.articleId : ''
    const tail = await forum.getDiscussionTail(articleId)

    // A count that included the hidden one would advertise it.
    expect(tail.total).toBe(2)
    expect(tail.recent.map((post) => post.body)).toEqual([
      'Deuxième message.',
      'Troisième message.',
    ])
  })

  it('shortens a long post rather than letting it dominate the article page', async () => {
    const slug = await publishedArticle()
    const reader = await makeUser('reader')
    await forum.createPost({
      actor: reader,
      slug,
      lang: 'fr',
      body: 'mot '.repeat(400),
    })

    const thread = await forum.getDiscussion({ slug, viewer: null })
    const tail = await forum.getDiscussionTail(thread.ok ? thread.value.articleId : '')

    expect(tail.recent[0].body?.length).toBeLessThanOrEqual(forum.TAIL_EXCERPT_CHARS + 1)
    expect(tail.recent[0].body?.endsWith('…')).toBe(true)
    // The whole post is still in the discussion; only the invitation is short.
    expect(thread.ok && thread.value.posts[0].body?.length).toBeGreaterThan(1000)
  })
})

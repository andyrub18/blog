import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../test/postgres'
import type { Viewer } from './articles'

/**
 * Articles against a real PostgreSQL.
 *
 * What is being tested here is the part whose correctness lives in SQL and in
 * transactions: that a save writes the translation and its revision together,
 * that publication is per language, that the fallback picks a language the
 * reader can actually be given, and that a reader without an account cannot
 * pull a `members` article out of the database. A mock would agree with
 * whatever the code did.
 */

let harness: TestDatabase
let articles: typeof import('./articles')
let schema: typeof import('./db/schema')

beforeAll(async () => {
  harness = await startTestDatabase()
  process.env.DATABASE_URL = harness.url
  articles = await import('./articles')
  schema = await import('./db/schema')
})

afterAll(async () => {
  await harness?.stop()
})

beforeEach(async () => {
  await harness.db.delete(schema.articleRevision)
  await harness.db.delete(schema.articleTranslation)
  await harness.db.delete(schema.article)
  await harness.db.delete(schema.user)
})

async function makeUser(role: string = 'member'): Promise<Viewer> {
  const id = randomUUID()
  await harness.db.insert(schema.user).values({
    id,
    name: `${role}-${id.slice(0, 4)}`,
    email: `${id}@kle.ht`,
    emailVerified: true,
    role: role as 'member',
    memberStatus: 'active',
  })
  return { id, role: role as Viewer['role'], memberStatus: 'active' }
}

const TITLE = 'La situation économique en Haïti'
const SUMMARY = 'Un diagnostic de la crise et les réponses que le mouvement propose.'

const body = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

async function startArticle(author: Viewer, title = TITLE) {
  const created = await articles.createArticle({
    author,
    lang: 'fr',
    title,
    summary: SUMMARY,
  })
  if (!created.ok) throw new Error(`createArticle failed: ${created.code}`)
  return created.value
}

async function writeAndPublish(
  author: Viewer,
  senior: Viewer,
  options: { lang?: string; title?: string; text?: string } = {},
) {
  const { articleId, slug } = await startArticle(author, options.title ?? TITLE)
  const lang = options.lang ?? 'fr'
  await articles.saveTranslation({
    actor: author,
    articleId,
    lang,
    title: options.title ?? TITLE,
    summary: SUMMARY,
    content: body(options.text ?? 'Le premier paragraphe.'),
  })
  const published = await articles.publishTranslation({ actor: senior, articleId, lang })
  if (!published.ok) throw new Error(`publishTranslation failed: ${published.code}`)
  return { articleId, slug }
}

describe('who may write', () => {
  it('refuses a reader — proposing an article is what admission buys', async () => {
    const reader = await makeUser('reader')
    const result = await articles.createArticle({
      author: reader,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('FORBIDDEN')
  })

  it('refuses a blocked member, whatever their role still says', async () => {
    const blocked = { ...(await makeUser('senior_member')), memberStatus: 'blocked' }
    const result = await articles.createArticle({
      author: blocked,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('FORBIDDEN')
  })

  it('refuses a title or summary that does not meet the standard', async () => {
    const author = await makeUser()
    const shortTitle = await articles.createArticle({
      author,
      lang: 'fr',
      title: 'court',
      summary: SUMMARY,
    })
    expect(shortTitle.ok).toBe(false)
    if (!shortTitle.ok) expect(shortTitle.code).toBe('INVALID_TITLE')

    const shortSummary = await articles.createArticle({
      author,
      lang: 'fr',
      title: TITLE,
      summary: 'trop court',
    })
    expect(shortSummary.ok).toBe(false)
    if (!shortSummary.ok) expect(shortSummary.code).toBe('INVALID_SUMMARY')
  })

  it('refuses a title that cannot become a URL rather than inventing one', async () => {
    const author = await makeUser()
    const result = await articles.createArticle({
      author,
      lang: 'fr',
      title: '!!! ??? ...',
      summary: SUMMARY,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NO_SLUG')
  })
})

describe('slugs', () => {
  it('gives two articles with the same title different URLs', async () => {
    const author = await makeUser()
    const first = await startArticle(author)
    const second = await startArticle(author)
    expect(first.slug).toBe('la-situation-economique-en-haiti')
    expect(second.slug).toBe('la-situation-economique-en-haiti-2')
  })
})

describe('saveTranslation', () => {
  it('writes the translation and its revision together', async () => {
    const author = await makeUser()
    const { articleId } = await startArticle(author)

    const saved = await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
      content: body('Premier jet.'),
    })
    expect(saved.ok).toBe(true)

    const revisions = await harness.db
      .select()
      .from(schema.articleRevision)
      .where(eq(schema.articleRevision.articleId, articleId))
    expect(revisions).toHaveLength(1)

    await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
      content: body('Deuxième jet.'),
    })

    const after = await harness.db
      .select()
      .from(schema.articleRevision)
      .where(eq(schema.articleRevision.articleId, articleId))
    // Every save is kept: this is the record a contradictor reads to see what
    // changed between rounds.
    expect(after).toHaveLength(2)
  })

  it('stores the sanitised document, not what the browser sent', async () => {
    const author = await makeUser()
    const { articleId } = await startArticle(author)

    await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
      content: {
        type: 'doc',
        content: [
          { type: 'script', content: [{ type: 'text', text: 'steal()' }] },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'lien',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      },
    })

    const [row] = await harness.db
      .select({ content: schema.articleTranslation.contentJson })
      .from(schema.articleTranslation)
      .where(eq(schema.articleTranslation.articleId, articleId))

    const stored = JSON.stringify(row.content)
    expect(stored).not.toContain('script')
    expect(stored).not.toContain('javascript:')
    expect(stored).toContain('lien')
  })

  it('refuses a document with nothing in it', async () => {
    const author = await makeUser()
    const { articleId } = await startArticle(author)
    const result = await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
      content: { type: 'doc', content: [] },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('EMPTY_CONTENT')
  })

  it('refuses another member editing somebody else’s draft', async () => {
    const author = await makeUser()
    const stranger = await makeUser()
    const { articleId } = await startArticle(author)

    const result = await articles.saveTranslation({
      actor: stranger,
      articleId,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
      content: body('Texte de quelqu’un d’autre.'),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('FORBIDDEN')
  })

  it('does not unpublish an article when its author edits it', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { articleId } = await writeAndPublish(author, senior)

    await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
      content: body('Une correction.'),
    })

    const [row] = await harness.db
      .select({ status: schema.articleTranslation.status })
      .from(schema.articleTranslation)
      .where(eq(schema.articleTranslation.articleId, articleId))
    expect(row.status).toBe('published')
  })
})

describe('publishing', () => {
  it('refuses the author publishing their own work', async () => {
    // The manifesto does not let an author decide their own proposal was
    // accepted. Phase 3 replaces the judgement behind this rule; the rule itself
    // has to be right from the first article.
    const author = await makeUser()
    const { articleId } = await startArticle(author)
    await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
      content: body('Prêt.'),
    })

    const result = await articles.publishTranslation({
      actor: author,
      articleId,
      lang: 'fr',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('FORBIDDEN')
  })

  it('refuses publishing a language nobody has written', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { articleId } = await startArticle(author)

    const result = await articles.publishTranslation({
      actor: senior,
      articleId,
      lang: 'fr',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('EMPTY_CONTENT')
  })

  it('publishes one language and leaves the other alone', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { articleId, slug } = await writeAndPublish(author, senior)

    await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'ht',
      title: 'Sitiyasyon ekonomik nan peyi a',
      summary: SUMMARY,
      content: body('Yon premye bouyon an kreyòl.'),
    })

    const rows = await harness.db
      .select({
        lang: schema.articleTranslation.lang,
        status: schema.articleTranslation.status,
      })
      .from(schema.articleTranslation)
      .where(eq(schema.articleTranslation.articleId, articleId))

    expect(rows.find((r) => r.lang === 'fr')?.status).toBe('published')
    expect(rows.find((r) => r.lang === 'ht')?.status).toBe('draft')

    // And the unpublished Creole is not served to a Creole reader.
    const read = await articles.getReadableArticle({ slug, lang: 'ht', viewer: null })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.lang).toBe('fr')
    expect(read.value.availableLangs).toEqual(['fr'])
  })

  it('keeps the article’s own publication date when a second language follows', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { articleId } = await writeAndPublish(author, senior)

    const [before] = await harness.db
      .select({ publishedAt: schema.article.publishedAt })
      .from(schema.article)
      .where(eq(schema.article.id, articleId))

    await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'ht',
      title: 'Sitiyasyon ekonomik nan peyi a',
      summary: SUMMARY,
      content: body('Tèks an kreyòl.'),
    })
    await articles.publishTranslation({ actor: senior, articleId, lang: 'ht' })

    const [after] = await harness.db
      .select({ publishedAt: schema.article.publishedAt })
      .from(schema.article)
      .where(eq(schema.article.id, articleId))

    expect(after.publishedAt?.getTime()).toBe(before.publishedAt?.getTime())
  })

  it('refuses to publish the same language twice', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { articleId } = await writeAndPublish(author, senior)

    const again = await articles.publishTranslation({
      actor: senior,
      articleId,
      lang: 'fr',
    })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.code).toBe('ALREADY_PUBLISHED')
  })

  it('withdraws one language without retracting the article', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { articleId, slug } = await writeAndPublish(author, senior)

    await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'ht',
      title: 'Sitiyasyon ekonomik nan peyi a',
      summary: SUMMARY,
      content: body('Tèks an kreyòl.'),
    })
    await articles.publishTranslation({ actor: senior, articleId, lang: 'ht' })

    const pulled = await articles.unpublishTranslation({
      actor: senior,
      articleId,
      lang: 'ht',
    })
    expect(pulled.ok).toBe(true)

    const read = await articles.getReadableArticle({ slug, lang: 'fr', viewer: null })
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.value.availableLangs).toEqual(['fr'])

    const [row] = await harness.db
      .select({ status: schema.article.status })
      .from(schema.article)
      .where(eq(schema.article.id, articleId))
    expect(row.status).toBe('published')
  })

  it('takes the article down when the last language is withdrawn, keeping its date', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { articleId, slug } = await writeAndPublish(author, senior)

    await articles.unpublishTranslation({ actor: senior, articleId, lang: 'fr' })

    const [row] = await harness.db
      .select({
        status: schema.article.status,
        publishedAt: schema.article.publishedAt,
      })
      .from(schema.article)
      .where(eq(schema.article.id, articleId))

    // The status has to follow, or the row claims the article is published
    // while nothing of it is readable.
    expect(row.status).toBe('draft')
    // The date stays: it records that this article did once reach readers.
    expect(row.publishedAt).not.toBeNull()

    const read = await articles.getReadableArticle({ slug, lang: 'fr', viewer: null })
    expect(read.ok).toBe(false)
  })

  it('refuses to withdraw a language that is not published', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { articleId } = await startArticle(author)

    const result = await articles.unpublishTranslation({
      actor: senior,
      articleId,
      lang: 'fr',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NOT_PUBLISHED')
  })
})

describe('what a reader gets', () => {
  it('serves a public article to somebody with no account at all', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { slug } = await writeAndPublish(author, senior)

    const read = await articles.getReadableArticle({ slug, lang: 'fr', viewer: null })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.title).toBe(TITLE)
    expect(read.value.html).toContain('<p>Le premier paragraphe.</p>')
    expect(read.value.lang).toBe(read.value.requestedLang)
  })

  it('refuses a members-only article to an anonymous reader, and serves it to an account', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const created = await articles.createArticle({
      author,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
      visibility: 'members',
    })
    if (!created.ok) throw new Error(created.code)
    await articles.saveTranslation({
      actor: author,
      articleId: created.value.articleId,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
      content: body('Travail interne.'),
    })
    await articles.publishTranslation({
      actor: senior,
      articleId: created.value.articleId,
      lang: 'fr',
    })

    const anonymous = await articles.getReadableArticle({
      slug: created.value.slug,
      lang: 'fr',
      viewer: null,
    })
    expect(anonymous.ok).toBe(false)
    if (!anonymous.ok) expect(anonymous.code).toBe('FORBIDDEN')

    const reader = await makeUser('reader')
    const signedIn = await articles.getReadableArticle({
      slug: created.value.slug,
      lang: 'fr',
      viewer: reader,
    })
    expect(signedIn.ok).toBe(true)
  })

  it('does not serve a draft', async () => {
    const author = await makeUser()
    const { slug, articleId } = await startArticle(author)
    await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
      content: body('Pas encore prêt.'),
    })

    const read = await articles.getReadableArticle({ slug, lang: 'fr', viewer: null })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.code).toBe('NOT_FOUND')
  })

  it('falls back to a language that exists rather than refusing the reader', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { slug } = await writeAndPublish(author, senior, { lang: 'fr' })

    const read = await articles.getReadableArticle({ slug, lang: 'ht', viewer: null })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    // The banner on the page is driven by these two fields disagreeing.
    expect(read.value.requestedLang).toBe('ht')
    expect(read.value.lang).toBe('fr')
  })

  it('prefers the reader’s language when it exists', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { articleId, slug } = await writeAndPublish(author, senior)
    await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'ht',
      title: 'Sitiyasyon ekonomik nan peyi a',
      summary: SUMMARY,
      content: body('Tèks an kreyòl.'),
    })
    await articles.publishTranslation({ actor: senior, articleId, lang: 'ht' })

    const read = await articles.getReadableArticle({ slug, lang: 'ht', viewer: null })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.lang).toBe('ht')
    expect(read.value.availableLangs).toEqual(['fr', 'ht'])
  })
})

describe('listPublished', () => {
  it('shows an article once, in the best language available', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { articleId } = await writeAndPublish(author, senior)
    await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'ht',
      title: 'Sitiyasyon ekonomik nan peyi a',
      summary: SUMMARY,
      content: body('Tèks an kreyòl.'),
    })
    await articles.publishTranslation({ actor: senior, articleId, lang: 'ht' })

    const creole = await articles.listPublished({ lang: 'ht', viewer: null })
    expect(creole).toHaveLength(1)
    expect(creole[0].lang).toBe('ht')
    expect(creole[0].isFallback).toBe(false)

    const french = await articles.listPublished({ lang: 'fr', viewer: null })
    expect(french[0].lang).toBe('fr')
  })

  it('marks a card the reader is getting in the wrong language', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    await writeAndPublish(author, senior, { lang: 'fr' })

    const creole = await articles.listPublished({ lang: 'ht', viewer: null })
    expect(creole[0].isFallback).toBe(true)
    expect(creole[0].lang).toBe('fr')
  })

  it('keeps members-only articles out of the anonymous index', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    await writeAndPublish(author, senior, {
      title: 'Un article public pour tout le monde',
    })

    const internal = await articles.createArticle({
      author,
      lang: 'fr',
      title: 'Une note interne au mouvement',
      summary: SUMMARY,
      visibility: 'members',
    })
    if (!internal.ok) throw new Error(internal.code)
    await articles.saveTranslation({
      actor: author,
      articleId: internal.value.articleId,
      lang: 'fr',
      title: 'Une note interne au mouvement',
      summary: SUMMARY,
      content: body('Interne.'),
    })
    await articles.publishTranslation({
      actor: senior,
      articleId: internal.value.articleId,
      lang: 'fr',
    })

    const anonymous = await articles.listPublished({ lang: 'fr', viewer: null })
    expect(anonymous.map((c) => c.visibility)).toEqual(['public'])

    const reader = await makeUser('reader')
    const signedIn = await articles.listPublished({ lang: 'fr', viewer: reader })
    expect(signedIn).toHaveLength(2)
  })
})

describe('the author’s desk', () => {
  it('lists an author’s own articles with the state of each language', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const { articleId } = await startArticle(author)
    await startArticle(other, 'Un tout autre sujet à traiter')

    await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'ht',
      title: 'Sitiyasyon ekonomik nan peyi a',
      summary: SUMMARY,
      content: body('Tèks.'),
    })

    const mine = await articles.listAuthored(author.id)
    expect(mine).toHaveLength(1)
    expect(mine[0].translations.map((t) => t.lang).sort()).toEqual(['fr', 'ht'])
  })

  it('opens a language that does not exist yet as a blank page', async () => {
    const author = await makeUser()
    const { articleId } = await startArticle(author)

    const editable = await articles.getEditableArticle({
      actor: author,
      articleId,
      lang: 'ht',
    })
    expect(editable.ok).toBe(true)
    if (!editable.ok) return
    expect(editable.value.translationStatus).toBe('new')
    expect(editable.value.otherLangs.map((t) => t.lang)).toEqual(['fr'])
  })

  it('lets a senior member open a draft, and not a stranger', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const stranger = await makeUser()
    const { articleId } = await startArticle(author)

    const bySenior = await articles.getEditableArticle({
      actor: senior,
      articleId,
      lang: 'fr',
    })
    expect(bySenior.ok).toBe(true)

    const byStranger = await articles.getEditableArticle({
      actor: stranger,
      articleId,
      lang: 'fr',
    })
    expect(byStranger.ok).toBe(false)
    if (!byStranger.ok) expect(byStranger.code).toBe('FORBIDDEN')
  })

  it('returns the revisions of one language, newest first', async () => {
    const author = await makeUser()
    const { articleId } = await startArticle(author)
    for (const text of ['Un.', 'Deux.', 'Trois.']) {
      await articles.saveTranslation({
        actor: author,
        articleId,
        lang: 'fr',
        title: TITLE,
        summary: SUMMARY,
        content: body(text),
      })
    }

    const revisions = await articles.listRevisions({
      actor: author,
      articleId,
      lang: 'fr',
    })
    expect(revisions.ok).toBe(true)
    if (!revisions.ok) return
    expect(revisions.value).toHaveLength(3)
    expect(revisions.value[0].createdAt.getTime()).toBeGreaterThanOrEqual(
      revisions.value[2].createdAt.getTime(),
    )
  })
})

describe('deleting an author', () => {
  it('takes their articles with them, not orphaned rows', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { articleId } = await writeAndPublish(author, senior)

    await harness.db.delete(schema.user).where(eq(schema.user.id, author.id))

    const remaining = await harness.db
      .select()
      .from(schema.articleTranslation)
      .where(and(eq(schema.articleTranslation.articleId, articleId)))
    expect(remaining).toHaveLength(0)
  })
})

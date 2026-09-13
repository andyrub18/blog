import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gt, inArray } from 'drizzle-orm'
import type { Viewer } from './articles'
import { canRead } from './articles'
import {
  article,
  articleTranslation,
  type ForumPostStatus,
  forumModeration,
  forumPost,
  hasAtLeastRole,
  user,
} from './db/schema'
import {
  isValidForumPost,
  MIN_MODERATION_RATIONALE_CHARS,
  normalizeForumPost,
} from './validation'

/**
 * The forum: one discussion per article, readers and above may post.
 *
 * Two rules shape everything here.
 *
 * **Read access follows the article.** The discussion on a `members` article is
 * visible to exactly the people the article is, decided by the same `canRead`.
 * A forum that answered "here are forty replies" about an article it would
 * refuse to show would be a side channel around D1 — and the replies quote the
 * article.
 *
 * **Nothing is deleted.** An author may withdraw their own post and a senior
 * member may hide one with a written reason; both leave the row in place with a
 * changed status. A thread that silently loses a post tells the people who
 * answered it a lie about what they were answering.
 */

export type ForumError =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_BODY'
  | 'RATIONALE_REQUIRED'
  | 'ALREADY_IN_STATE'

export type ForumResult<T> = { ok: true; value: T } | { ok: false; code: ForumError }

/** How many posts the article page shows under the article itself. */
export const TAIL_POSTS = 3

/**
 * Who may post.
 *
 * Readers and above, which is every account: the `reader` tier exists for this
 * (`01-ENROLLMENT.md`), and it is reached by verifying an email address and
 * passing a captcha. Reading stays open to everyone, with no account at all.
 */
export function canPost(viewer: Viewer | null): boolean {
  if (!viewer) return false
  return viewer.memberStatus !== 'blocked' && hasAtLeastRole(viewer.role, 'reader')
}

/** Senior members moderate, as they do everywhere else in the movement. */
export function canModerate(viewer: Viewer | null): boolean {
  if (!viewer) return false
  return viewer.memberStatus !== 'blocked' && hasAtLeastRole(viewer.role, 'senior_member')
}

export type ForumPostView = {
  id: string
  parentId: string | null
  authorId: string
  authorName: string
  lang: string
  status: ForumPostStatus
  /**
   * Null when the post is hidden or withdrawn and the reader is not a
   * moderator. The thread still shows that something was there and who wrote
   * it; what it said does not go back on the wire.
   */
  body: string | null
  createdAt: Date
  editedAt: Date | null
  changedAt: Date
}

export type Discussion = {
  articleId: string
  slug: string
  title: string
  /**
   * The signed-in account, or null.
   *
   * The thread needs it to know which posts offer "edit" and "withdraw". The
   * server decides whether those actions are allowed; this only decides whether
   * the buttons are worth drawing.
   */
  viewerId: string | null
  /** Whether *this* viewer may add to it, so the page need not guess. */
  canPost: boolean
  canModerate: boolean
  posts: Array<ForumPostView>
}

/**
 * The article a discussion belongs to, if this viewer may see it at all.
 *
 * Every entry point goes through here: reading the thread, posting to it,
 * moderating in it. The article must be published — a discussion under a draft
 * would be a way to read one — and the viewer must pass the article's own
 * visibility rule.
 */
async function readableArticle(
  slug: string,
  viewer: Viewer | null,
): Promise<ForumResult<{ id: string; title: string }>> {
  const { db } = await import('./db')
  const [row] = await db
    .select({
      id: article.id,
      visibility: article.visibility,
      title: articleTranslation.title,
    })
    .from(article)
    .innerJoin(articleTranslation, eq(articleTranslation.articleId, article.id))
    .where(
      and(
        eq(article.slug, slug),
        eq(article.status, 'published'),
        eq(articleTranslation.status, 'published'),
      ),
    )
    .limit(1)

  if (!row) return { ok: false, code: 'NOT_FOUND' }
  if (!canRead(row.visibility, viewer)) return { ok: false, code: 'FORBIDDEN' }
  return { ok: true, value: { id: row.id, title: row.title } }
}

/**
 * A post as it goes on the wire.
 *
 * A moderator keeps the body of a hidden post, because restoring a post you
 * cannot read is a decision taken blind.
 */
function toView(
  row: {
    id: string
    parentId: string | null
    authorId: string
    authorName: string
    lang: string
    status: ForumPostStatus
    body: string
    createdAt: Date
    editedAt: Date | null
    changedAt: Date
  },
  moderator: boolean,
): ForumPostView {
  const readable = row.status === 'visible' || moderator
  return { ...row, body: readable ? row.body : null }
}

const POST_COLUMNS = {
  id: forumPost.id,
  parentId: forumPost.parentId,
  authorId: forumPost.authorId,
  authorName: user.name,
  lang: forumPost.lang,
  status: forumPost.status,
  body: forumPost.body,
  createdAt: forumPost.createdAt,
  editedAt: forumPost.editedAt,
  changedAt: forumPost.changedAt,
}

/**
 * One article's whole discussion, oldest first.
 *
 * `since` is the poller's question — everything that changed after this moment
 * — and it is asked against `changed_at`, not `created_at`. A post that was
 * hidden a second ago created no row, and it is the one the tabs holding it
 * most need to hear about.
 */
export async function getDiscussion(input: {
  slug: string
  viewer: Viewer | null
  since?: Date | null
}): Promise<ForumResult<Discussion>> {
  const found = await readableArticle(input.slug, input.viewer)
  if (!found.ok) return found

  const moderator = canModerate(input.viewer)
  const { db } = await import('./db')
  const rows = await db
    .select(POST_COLUMNS)
    .from(forumPost)
    .innerJoin(user, eq(user.id, forumPost.authorId))
    .where(
      input.since
        ? and(
            eq(forumPost.articleId, found.value.id),
            gt(forumPost.changedAt, input.since),
          )
        : eq(forumPost.articleId, found.value.id),
    )
    .orderBy(asc(forumPost.createdAt))

  return {
    ok: true,
    value: {
      articleId: found.value.id,
      slug: input.slug,
      title: found.value.title,
      viewerId: input.viewer?.id ?? null,
      canPost: canPost(input.viewer),
      canModerate: moderator,
      posts: rows.map((row) => toView(row, moderator)),
    },
  }
}

export type DiscussionTail = {
  /** Visible posts only: a count that includes hidden ones advertises them. */
  total: number
  recent: Array<ForumPostView>
}

/**
 * How much of a post the article page shows.
 *
 * A post may run to four thousand characters. Three of those under an article
 * would make the tail longer than some articles, on the page whose weight this
 * project is built around — and the tail is an invitation, not the discussion.
 */
export const TAIL_EXCERPT_CHARS = 240

function excerpt(body: string): string {
  if (body.length <= TAIL_EXCERPT_CHARS) return body
  const cut = body.slice(0, TAIL_EXCERPT_CHARS)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > TAIL_EXCERPT_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * What the article page shows under the article.
 *
 * The reading view spends no JavaScript on the forum, so this is the whole of
 * the forum it gets: a count and the last few posts, server-rendered. A
 * published article with a visible "14 responses" is an invitation; a silent
 * link is not.
 *
 * Takes an article id rather than a slug because the caller — `fetchArticle` —
 * has already resolved the article and checked that this reader may have it.
 * Asking again would be a second query to reach the same answer.
 */
export async function getDiscussionTail(articleId: string): Promise<DiscussionTail> {
  const { db } = await import('./db')
  const [[tally], rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(forumPost)
      .where(and(eq(forumPost.articleId, articleId), eq(forumPost.status, 'visible'))),
    db
      .select(POST_COLUMNS)
      .from(forumPost)
      .innerJoin(user, eq(user.id, forumPost.authorId))
      .where(and(eq(forumPost.articleId, articleId), eq(forumPost.status, 'visible')))
      .orderBy(desc(forumPost.createdAt))
      .limit(TAIL_POSTS),
  ])

  return {
    total: tally?.total ?? 0,
    // Newest first out of the database so the limit takes the newest, then
    // reversed so the reader sees them in the order they were said.
    recent: rows
      .reverse()
      .map((row) => toView({ ...row, body: excerpt(row.body) }, false)),
  }
}

/**
 * Say something.
 *
 * The body is normalised here, on the server, before it is stored: the form in
 * the browser applies the same rule from `validation.ts`, but that copy is a
 * courtesy to the person typing and this one is the one that counts.
 */
export async function createPost(input: {
  actor: Viewer
  slug: string
  lang: string
  body: string
  parentId?: string | null
}): Promise<ForumResult<ForumPostView>> {
  if (!canPost(input.actor)) return { ok: false, code: 'FORBIDDEN' }
  if (!isValidForumPost(input.body)) return { ok: false, code: 'INVALID_BODY' }

  const found = await readableArticle(input.slug, input.actor)
  if (!found.ok) return found

  const { db } = await import('./db')

  let parentId: string | null = null
  if (input.parentId) {
    const [parent] = await db
      .select({
        id: forumPost.id,
        parentId: forumPost.parentId,
        articleId: forumPost.articleId,
      })
      .from(forumPost)
      .where(eq(forumPost.id, input.parentId))
      .limit(1)

    // A reply to a post in another article's thread would be a way to move a
    // conversation somewhere it cannot be read.
    if (!parent || parent.articleId !== found.value.id) {
      return { ok: false, code: 'NOT_FOUND' }
    }
    // One level deep: answering a reply attaches to the post it is under, not
    // to the reply. Enforced here rather than refused, because from the
    // reader's side they did nothing wrong — they pressed reply.
    parentId = parent.parentId ?? parent.id
  }

  const now = new Date()
  const row = {
    id: randomUUID(),
    articleId: found.value.id,
    lang: input.lang,
    authorId: input.actor.id,
    parentId,
    body: normalizeForumPost(input.body),
    status: 'visible' as const,
    createdAt: now,
    editedAt: null,
    changedAt: now,
  }
  await db.insert(forumPost).values(row)

  const [author] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, input.actor.id))
    .limit(1)

  return {
    ok: true,
    value: toView({ ...row, authorName: author?.name ?? '' }, false),
  }
}

/**
 * Correct what you wrote.
 *
 * Only the author, and the change is marked: `edited_at` is what lets the
 * thread say so. An edit that left no trace would let somebody rewrite what
 * three people had already answered.
 */
export async function editPost(input: {
  actor: Viewer
  postId: string
  body: string
}): Promise<ForumResult<{ editedAt: Date }>> {
  if (!isValidForumPost(input.body)) return { ok: false, code: 'INVALID_BODY' }

  const { db } = await import('./db')
  const [post] = await db
    .select({ id: forumPost.id, authorId: forumPost.authorId, status: forumPost.status })
    .from(forumPost)
    .where(eq(forumPost.id, input.postId))
    .limit(1)

  if (!post) return { ok: false, code: 'NOT_FOUND' }
  if (post.authorId !== input.actor.id) return { ok: false, code: 'FORBIDDEN' }
  // Editing a hidden post would be a way to launder it back into the thread if
  // it were ever restored; a withdrawn one is already gone by its author's
  // choice.
  if (post.status !== 'visible') return { ok: false, code: 'ALREADY_IN_STATE' }

  const now = new Date()
  await db
    .update(forumPost)
    .set({ body: normalizeForumPost(input.body), editedAt: now, changedAt: now })
    .where(eq(forumPost.id, input.postId))

  return { ok: true, value: { editedAt: now } }
}

/** Take your own post back. The row stays; the text stops being served. */
export async function withdrawPost(input: {
  actor: Viewer
  postId: string
}): Promise<ForumResult<{ postId: string }>> {
  const { db } = await import('./db')
  const [post] = await db
    .select({ id: forumPost.id, authorId: forumPost.authorId, status: forumPost.status })
    .from(forumPost)
    .where(eq(forumPost.id, input.postId))
    .limit(1)

  if (!post) return { ok: false, code: 'NOT_FOUND' }
  if (post.authorId !== input.actor.id) return { ok: false, code: 'FORBIDDEN' }
  // A moderator's decision is not something its subject can overwrite.
  if (post.status !== 'visible') return { ok: false, code: 'ALREADY_IN_STATE' }

  const now = new Date()
  await db
    .update(forumPost)
    .set({ status: 'withdrawn', changedAt: now })
    .where(eq(forumPost.id, input.postId))

  return { ok: true, value: { postId: input.postId } }
}

/**
 * Hide a post, or put it back, with a written reason.
 *
 * The status change and the record of why are one transaction. A moderation
 * whose account of itself could fail separately is a moderation nobody can
 * audit, and this codebase's answer to power is the same everywhere: it is
 * exercised in the open and it is written down.
 */
export async function moderatePost(input: {
  actor: Viewer
  postId: string
  hidden: boolean
  rationale: string
}): Promise<ForumResult<{ postId: string; status: ForumPostStatus }>> {
  if (!canModerate(input.actor)) return { ok: false, code: 'FORBIDDEN' }

  const rationale = input.rationale.trim()
  if (rationale.length < MIN_MODERATION_RATIONALE_CHARS) {
    return { ok: false, code: 'RATIONALE_REQUIRED' }
  }

  const { db } = await import('./db')
  const [post] = await db
    .select({ id: forumPost.id, status: forumPost.status })
    .from(forumPost)
    .where(eq(forumPost.id, input.postId))
    .limit(1)

  if (!post) return { ok: false, code: 'NOT_FOUND' }
  if ((post.status === 'hidden') === input.hidden) {
    return { ok: false, code: 'ALREADY_IN_STATE' }
  }
  // Restoring a post its author withdrew would overrule them with their own
  // words. Only a moderator's own decision is a moderator's to undo.
  if (!input.hidden && post.status !== 'hidden') {
    return { ok: false, code: 'ALREADY_IN_STATE' }
  }

  const now = new Date()
  const status: ForumPostStatus = input.hidden ? 'hidden' : 'visible'

  await db.transaction(async (tx) => {
    await tx
      .update(forumPost)
      .set({ status, changedAt: now })
      .where(eq(forumPost.id, input.postId))

    await tx.insert(forumModeration).values({
      id: randomUUID(),
      postId: input.postId,
      actorId: input.actor.id,
      action: input.hidden ? 'hidden' : 'restored',
      rationale,
    })
  })

  return { ok: true, value: { postId: input.postId, status } }
}

export type ModerationRecord = {
  id: string
  postId: string
  action: string
  rationale: string
  actorName: string | null
  createdAt: Date
}

/**
 * Why the posts in this thread were hidden, and by whom.
 *
 * Moderators only, and it exists because an account of a decision that nobody
 * can read is not an account of anything. It is shown inline, under the post it
 * explains, rather than on a page of its own: the question "why is this hidden"
 * is asked in the thread, and an audit trail somebody has to go looking for is
 * one nobody looks at.
 *
 * Scoped to the posts the caller is already looking at, so it cannot be used to
 * page through every moderation the movement has ever made.
 */
export async function listModerations(input: {
  actor: Viewer
  postIds: Array<string>
}): Promise<ForumResult<Array<ModerationRecord>>> {
  if (!canModerate(input.actor)) return { ok: false, code: 'FORBIDDEN' }
  if (input.postIds.length === 0) return { ok: true, value: [] }

  const { db } = await import('./db')
  const rows = await db
    .select({
      id: forumModeration.id,
      postId: forumModeration.postId,
      action: forumModeration.action,
      rationale: forumModeration.rationale,
      actorName: user.name,
      createdAt: forumModeration.createdAt,
    })
    .from(forumModeration)
    .leftJoin(user, eq(user.id, forumModeration.actorId))
    .where(inArray(forumModeration.postId, input.postIds))
    .orderBy(desc(forumModeration.createdAt))

  return { ok: true, value: rows }
}

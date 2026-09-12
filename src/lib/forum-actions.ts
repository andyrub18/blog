import { createServerFn } from '@tanstack/solid-start'
import { isLocale, type Locale } from '../i18n'
import type { Viewer } from './articles'
import { resolveRequestLocale } from './email/locale'
import type { Discussion, ForumError, ForumPostView } from './forum'

/**
 * The forum endpoints.
 *
 * Every one of them re-checks the caller. A route guard is UX; a
 * `createServerFn` is a public HTTP endpoint, and `postToDiscussion` is the one
 * somebody would call directly — both to post as themselves under an article
 * they cannot read, and to post a great deal of it.
 *
 * `fetchDiscussion` takes an *optional* session on purpose: a public article's
 * discussion is readable with no account, the same way the article is (D1).
 * What it must never do is let the absence of a session widen what comes back,
 * so it passes the viewer — null included — to the rules in `forum.ts`.
 */

export type ForumErrorCode = ForumError | 'RATE_LIMITED' | 'UNEXPECTED'

export type ForumActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ForumErrorCode }

/** The signed-in account, or null. Never throws: anonymous reading is normal. */
async function currentViewer(): Promise<Viewer | null> {
  const { getSession } = await import('./session.server')
  const session = await getSession()
  if (!session?.user) return null
  if (session.user.memberStatus === 'blocked') return null
  return {
    id: session.user.id,
    role: session.user.role,
    memberStatus: session.user.memberStatus,
  }
}

/** The signed-in account, required. Redirects the way every other guard does. */
async function requirePoster(): Promise<Viewer> {
  const { requireUser } = await import('./session.server')
  const user = await requireUser()
  return { id: user.id, role: user.role, memberStatus: user.memberStatus }
}

/** The language a post is attributed to: what the URL said, never a cookie. */
function localeOf(value: unknown): Locale {
  return typeof value === 'string' && isLocale(value) ? value : resolveRequestLocale()
}

/**
 * A whole thread, or everything that changed in it since a moment.
 *
 * The `since` form is what the poller sends. It is a delta by design: a reader
 * on metered mobile data should not pay for the forty posts they already have
 * every few seconds to find out whether a forty-first arrived.
 */
export const fetchDiscussion = createServerFn({ method: 'GET' })
  .validator((data: { slug: string; since?: string | null }) => {
    if (!data?.slug) throw new Error('slug is required')
    return {
      slug: String(data.slug),
      since: data.since ? String(data.since) : null,
    }
  })
  .handler(async ({ data }): Promise<ForumActionResult<Discussion>> => {
    const viewer = await currentViewer()
    const { getDiscussion } = await import('./forum')
    const since = data.since ? new Date(data.since) : null
    const result = await getDiscussion({
      slug: data.slug,
      viewer,
      // An unparseable timestamp asks for the whole thread rather than for
      // everything since the epoch of a NaN comparison, which returns nothing.
      since: since && !Number.isNaN(since.getTime()) ? since : null,
    })
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, code: result.code }
  })

export const postToDiscussion = createServerFn({ method: 'POST' })
  .validator((data: { slug: string; body: string; lang?: string; parentId?: string }) => {
    if (!data?.slug) throw new Error('slug is required')
    return {
      slug: String(data.slug),
      body: String(data.body ?? ''),
      lang: data.lang ? String(data.lang) : undefined,
      parentId: data.parentId ? String(data.parentId) : null,
    }
  })
  .handler(async ({ data }): Promise<ForumActionResult<ForumPostView>> => {
    const actor = await requirePoster()

    const { consume, RULES } = await import('./rate-limit')
    const gate = await consume(`forumPost:user:${actor.id}`, RULES.forumPost)
    if (!gate.allowed) return { ok: false, code: 'RATE_LIMITED' }

    const { createPost } = await import('./forum')
    try {
      const result = await createPost({
        actor,
        slug: data.slug,
        lang: localeOf(data.lang),
        body: data.body,
        parentId: data.parentId,
      })
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, code: result.code }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

export const editMyPost = createServerFn({ method: 'POST' })
  .validator((data: { postId: string; body: string }) => {
    if (!data?.postId) throw new Error('postId is required')
    return { postId: String(data.postId), body: String(data.body ?? '') }
  })
  .handler(async ({ data }): Promise<ForumActionResult<{ editedAt: Date }>> => {
    const actor = await requirePoster()
    const { editPost } = await import('./forum')
    try {
      const result = await editPost({ actor, postId: data.postId, body: data.body })
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, code: result.code }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

export const withdrawMyPost = createServerFn({ method: 'POST' })
  .validator((data: { postId: string }) => {
    if (!data?.postId) throw new Error('postId is required')
    return { postId: String(data.postId) }
  })
  .handler(async ({ data }): Promise<ForumActionResult<{ postId: string }>> => {
    const actor = await requirePoster()
    const { withdrawPost } = await import('./forum')
    try {
      const result = await withdrawPost({ actor, postId: data.postId })
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, code: result.code }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

export const moderateDiscussionPost = createServerFn({ method: 'POST' })
  .validator((data: { postId: string; hidden: boolean; rationale: string }) => {
    if (!data?.postId) throw new Error('postId is required')
    return {
      postId: String(data.postId),
      hidden: data.hidden !== false,
      rationale: String(data.rationale ?? ''),
    }
  })
  .handler(
    async ({ data }): Promise<ForumActionResult<{ postId: string; status: string }>> => {
      const actor = await requirePoster()
      const { moderatePost } = await import('./forum')
      try {
        const result = await moderatePost({
          actor,
          postId: data.postId,
          hidden: data.hidden,
          rationale: data.rationale,
        })
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, code: result.code }
      } catch {
        return { ok: false, code: 'UNEXPECTED' }
      }
    },
  )

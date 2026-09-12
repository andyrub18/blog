import { createServerFn } from '@tanstack/solid-start'
import { isLocale, type Locale } from '../i18n'
import type {
  ArticleCard,
  ArticleError,
  AuthoredArticle,
  EditableArticle,
  ReadableArticle,
  Viewer,
} from './articles'
import type { ArticleVisibility } from './db/schema'
import { resolveRequestLocale } from './email/locale'

/**
 * The article endpoints.
 *
 * Every one of these re-checks the caller on the server. A route guard is UX; a
 * `createServerFn` is a public HTTP endpoint, and `saveArticle` in particular is
 * the one somebody would call directly to put text under another member's
 * byline. The role check therefore lives in the handler, next to the work.
 *
 * The reading endpoints are the exception that proves the rule: they take an
 * *optional* session on purpose, because a public article must be readable with
 * no account at all (DECISIONS.md, D1). What they must not do is let the
 * absence of a session widen what is returned, so they pass the viewer — null
 * included — to `canRead` rather than deciding here.
 */

export type ArticleErrorCode = ArticleError | 'UNEXPECTED'

/** A readable article minus its source document — see `fetchArticle`. */
export type RenderedArticle = Omit<ReadableArticle, 'doc'>

export type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ArticleErrorCode }

/** The signed-in account, or null. Never throws: anonymous reading is normal here. */
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
async function requireWriter(): Promise<Viewer> {
  const { requireUser } = await import('./session.server')
  const user = await requireUser()
  return { id: user.id, role: user.role, memberStatus: user.memberStatus }
}

/**
 * The language a write applies to.
 *
 * The caller may name one, but only a language the site actually speaks: the
 * column is deliberately not constrained in the database, so that phase 6 can
 * add `en` and `es` without a migration, and this is where that openness is
 * held shut in the meantime. Anything else falls back to the language of the
 * request — the URL prefix Paraglide resolved, not a cookie the page may
 * disagree with.
 */
function localeOf(value: unknown): Locale {
  return typeof value === 'string' && isLocale(value) ? value : resolveRequestLocale()
}

export const fetchArticleIndex = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<ArticleCard>> => {
    const viewer = await currentViewer()
    const { listPublished } = await import('./articles')
    return listPublished({ lang: resolveRequestLocale(), viewer })
  },
)

export const fetchArticle = createServerFn({ method: 'GET' })
  .validator((data: { slug: string }) => {
    if (!data?.slug) throw new Error('slug is required')
    return { slug: String(data.slug) }
  })
  .handler(async ({ data }): Promise<ActionResult<RenderedArticle>> => {
    const viewer = await currentViewer()
    const { getReadableArticle } = await import('./articles')
    const result = await getReadableArticle({
      slug: data.slug,
      lang: resolveRequestLocale(),
      viewer,
    })
    if (!result.ok) return { ok: false, code: result.code }

    // The document itself stays on the server. Loader data is serialised into
    // the SSR response, so returning both `doc` and the HTML rendered from it
    // would send every reader the same article twice — on the one page whose
    // weight this project is built around.
    const { doc: _doc, ...rendered } = result.value
    return { ok: true, value: rendered }
  })

export const fetchMyArticles = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<AuthoredArticle>> => {
    const viewer = await requireWriter()
    const { canWrite, listAuthored } = await import('./articles')
    if (!canWrite(viewer)) return []
    return listAuthored(viewer.id)
  },
)

export const createArticleAction = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      title: string
      summary: string
      lang?: string
      visibility?: ArticleVisibility
    }) => ({
      title: String(data?.title ?? ''),
      summary: String(data?.summary ?? ''),
      lang: data?.lang ? String(data.lang) : undefined,
      visibility:
        data?.visibility === 'members' ? ('members' as const) : ('public' as const),
    }),
  )
  .handler(
    async ({ data }): Promise<ActionResult<{ articleId: string; slug: string }>> => {
      const author = await requireWriter()
      const { createArticle } = await import('./articles')
      try {
        const result = await createArticle({
          author,
          lang: localeOf(data.lang),
          title: data.title,
          summary: data.summary,
          visibility: data.visibility,
        })
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, code: result.code }
      } catch {
        return { ok: false, code: 'UNEXPECTED' }
      }
    },
  )

export const fetchEditableArticle = createServerFn({ method: 'GET' })
  .validator((data: { articleId: string; lang?: string }) => {
    if (!data?.articleId) throw new Error('articleId is required')
    return {
      articleId: String(data.articleId),
      lang: data.lang ? String(data.lang) : undefined,
    }
  })
  .handler(async ({ data }): Promise<ActionResult<EditableArticle>> => {
    const actor = await requireWriter()
    const { getEditableArticle } = await import('./articles')
    const result = await getEditableArticle({
      actor,
      articleId: data.articleId,
      lang: localeOf(data.lang),
    })
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, code: result.code }
  })

export const saveArticle = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      articleId: string
      lang: string
      title: string
      summary: string
      content: unknown
    }) => {
      if (!data?.articleId) throw new Error('articleId is required')
      return {
        articleId: String(data.articleId),
        lang: String(data.lang ?? ''),
        title: String(data.title ?? ''),
        summary: String(data.summary ?? ''),
        // Left as-is on purpose. `parseDocument` on the other side is the thing
        // that decides what a document may contain, and a validator here that
        // pre-judged the shape would be a second, weaker copy of that rule.
        content: data.content,
      }
    },
  )
  .handler(async ({ data }): Promise<ActionResult<{ savedAt: string }>> => {
    const actor = await requireWriter()
    const { saveTranslation } = await import('./articles')
    try {
      const result = await saveTranslation({
        actor,
        articleId: data.articleId,
        lang: localeOf(data.lang),
        title: data.title,
        summary: data.summary,
        content: data.content,
      })
      return result.ok
        ? { ok: true, value: { savedAt: result.value.savedAt.toISOString() } }
        : { ok: false, code: result.code }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

export const publishArticle = createServerFn({ method: 'POST' })
  .validator((data: { articleId: string; lang: string; publish: boolean }) => {
    if (!data?.articleId) throw new Error('articleId is required')
    return {
      articleId: String(data.articleId),
      lang: String(data.lang ?? ''),
      publish: data.publish !== false,
    }
  })
  .handler(async ({ data }): Promise<ActionResult<{ lang: string }>> => {
    const actor = await requireWriter()
    const { publishTranslation, unpublishTranslation } = await import('./articles')
    try {
      const result = data.publish
        ? await publishTranslation({ actor, articleId: data.articleId, lang: data.lang })
        : await unpublishTranslation({
            actor,
            articleId: data.articleId,
            lang: data.lang,
          })
      return result.ok
        ? { ok: true, value: { lang: data.lang } }
        : { ok: false, code: result.code }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

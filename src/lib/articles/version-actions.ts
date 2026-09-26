import { createServerFn } from '@tanstack/solid-start'
import { resolveRequestLocale } from '../email/locale'

/**
 * Version history's server function, in a module of its own.
 *
 * Not in `article-actions.ts`: the reading view imports that module, and every
 * server function in it puts a stub in the page's graph. The reading view has
 * no use for this one, and the budget has no room for passengers.
 */

/** The signed-in account, or null. Never throws: anonymous reading is normal here. */
async function currentViewer() {
  const { getSession } = await import('../auth/session.server')
  const session = await getSession()
  if (!session?.user || session.user.memberStatus === 'blocked') return null
  return {
    id: session.user.id,
    role: session.user.role,
    memberStatus: session.user.memberStatus,
  }
}

/**
 * The approved versions of an article, and what each changed (D31).
 *
 * Public exactly as the article is: `readerHistory` applies the same visibility
 * rule as the reading view. It lists approved versions only, each compared with
 * the previous approved one — a refused version's text was never published, and
 * a comparison against it would publish it as the "removed" side of a change.
 */
export const fetchVersionHistory = createServerFn({ method: 'GET' })
  .validator((data: { slug: string }) => {
    if (!data?.slug) throw new Error('slug is required')
    return { slug: String(data.slug) }
  })
  .handler(async ({ data }) => {
    const viewer = await currentViewer()
    const [{ readerHistory }, { m }] = await Promise.all([
      import('./versions'),
      import('../../paraglide/messages'),
    ])
    return readerHistory({
      slug: data.slug,
      lang: resolveRequestLocale(),
      viewer,
      labels: {
        unchanged: (count) => m.diff_unchanged({ count: String(count) }),
        reformatted: m.diff_reformatted(),
      },
    })
  })

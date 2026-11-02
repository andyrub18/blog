import { createFileRoute } from '@tanstack/solid-router'
import { fetchArticleIndexPage } from '../../../lib/articles/article-actions'

/**
 * The public index.
 *
 * No guard. Reading the movement's articles must never require an account —
 * reach is the point (DECISIONS.md, D1) — and the server function decides for
 * itself whether the caller gets the `members` articles as well. Rendered on the
 * server, like the home page it shares its cards with (`front-page.ts`).
 */
export const Route = createFileRoute('/_app/articles/')({
  loader: () => fetchArticleIndexPage(),
  component: ArticleIndex,
})

function ArticleIndex() {
  const html = Route.useLoaderData()
  // Safe because `renderArticleIndex` wrote every tag and escaped every value.
  return <main class="flex-1 px-4 py-12 md:px-6" innerHTML={html()} />
}

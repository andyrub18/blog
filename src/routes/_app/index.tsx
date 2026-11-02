import { createFileRoute } from '@tanstack/solid-router'
import { fetchFrontPage } from '../../lib/articles/article-actions'

/**
 * The front door.
 *
 * A visitor is told what the movement publishes and how — nothing reaches this
 * site without a panel, a contradictor and the circle's decision, and that is
 * the reason to trust what is on it — then shown the latest articles, which
 * need no account (D1). Somebody signed in gets the work waiting for them
 * instead of the explanation they have already read.
 *
 * The page is rendered on the server, in the reader's language, and ships no
 * JavaScript of its own; `lib/articles/front-page.ts` says why.
 */
export const Route = createFileRoute('/_app/')({
  loader: () => fetchFrontPage(),
  component: Home,
})

function Home() {
  const html = Route.useLoaderData()
  // Safe because `renderFrontPage` wrote every tag and escaped every value in
  // it, titles and names included. It would not be safe for HTML from anywhere
  // else.
  return <main class="flex-1" innerHTML={html()} />
}

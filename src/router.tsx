import { createRouter as createTanStackRouter } from '@tanstack/solid-router'
import { deLocalizeUrl, localizeUrl } from './paraglide/runtime'
import { routeTree } from './routeTree.gen'

/**
 * How long a preloaded route's data stays usable.
 *
 * It used to be `0`, which quietly made preloading worse than not preloading at
 * all: hovering a link ran the route's loader, the result was stale the instant
 * it arrived, and clicking through fetched the same thing again. Every preload
 * was a server-function response paid for twice — on connections where the
 * reader is paying by the megabyte.
 *
 * Thirty seconds is long enough that the fetch a hover triggered is the one the
 * click uses, and short enough that a reviewer coming back to a queue does not
 * act on a minute-old tally.
 */
const PRELOAD_STALE_TIME_MS = 30_000

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,

    /**
     * Locale lives in the URL, not in a route parameter.
     *
     * `input` strips the prefix before matching, so `/ht/auth/login` resolves
     * against the route declared at `/auth/login`. `output` puts it back when
     * the router generates a link, so every <Link> is automatically localized
     * and no component has to thread a language through.
     */
    rewrite: {
      input: ({ url }) => deLocalizeUrl(url),
      output: ({ url }) => localizeUrl(url),
    },

    scrollRestoration: true,
    /**
     * On a phone — which is how most readers arrive — `intent` fires on
     * touchstart, a few milliseconds before the tap completes, so this is
     * effectively "start loading on tap" rather than speculative fetching.
     */
    defaultPreload: 'intent',
    defaultPreloadStaleTime: PRELOAD_STALE_TIME_MS,
  })

  return router
}

declare module '@tanstack/solid-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}

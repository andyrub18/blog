import { createRouter as createTanStackRouter } from '@tanstack/solid-router'
import { getContext } from './integrations/tanstack-query/provider'
import { deLocalizeUrl, localizeUrl } from './paraglide/runtime'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,

    context: getContext(),

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
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  return router
}

declare module '@tanstack/solid-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}

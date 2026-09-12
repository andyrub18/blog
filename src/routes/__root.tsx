import { HydrationScript } from '@solidjs/web'
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/solid-router'
import { TanStackRouterDevtools } from '@tanstack/solid-router-devtools'
import { Loading } from 'solid-js'

import { getLocale } from '../paraglide/runtime'
import styleCss from '../styles.css?url'

export const Route = createRootRouteWithContext()({
  head: () => ({
    links: [
      { rel: 'stylesheet', href: styleCss },
      { rel: 'alternate', hreflang: 'fr', href: '/fr' },
      { rel: 'alternate', hreflang: 'ht', href: '/ht' },
      { rel: 'alternate', hreflang: 'x-default', href: '/fr' },
    ],
  }),
  shellComponent: RootComponent,
})

function RootComponent() {
  /**
   * The document language.
   *
   * This matters more here than on a monolingual site: screen readers pick
   * pronunciation from it, and search engines use it to decide which audience a
   * page serves. Getting it wrong means a Creole page announced in French.
   */
  return (
    <html lang={getLocale()}>
      <head>
        <HydrationScript />
        <HeadContent />
      </head>
      <body>
        <Loading>
          <Outlet />
          <TanStackRouterDevtools />
        </Loading>
        <Scripts />
      </body>
    </html>
  )
}

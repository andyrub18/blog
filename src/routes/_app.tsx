import { createFileRoute, Outlet } from '@tanstack/solid-router'
import { createEffect } from 'solid-js'
import SiteFooter from '../components/layout/SiteFooter'
import SiteHeader from '../components/layout/SiteHeader'
import { fetchPublicConfig } from '../lib/auth/public-config'
import { fetchSessionUser } from '../lib/auth/session'

/**
 * Pathless layout carrying the session.
 *
 * There is no `$lang` segment: Paraglide owns the locale. The middleware in
 * `src/server.ts` reads it from the URL, and the router de-localizes incoming
 * paths and localizes outgoing links (see `src/router.tsx`), so routes are
 * written once at their plain path.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const [user, config] = await Promise.all([fetchSessionUser(), fetchPublicConfig()])
    return { user, config }
  },
  component: AppLayout,
})

function AppLayout() {
  const context = Route.useRouteContext()

  /**
   * Mark the document once the client has taken over.
   *
   * Server-rendered markup looks identical before and after hydration, so
   * nothing otherwise distinguishes a page that is merely painted from one that
   * answers clicks. End-to-end tests need that distinction, and so would
   * anything we ever want to keep hidden until it works. It lives here rather
   * than in the shell because the shell is rendered on the server only.
   *
   * Solid 2 has no `onMount`: an effect with a constant compute runs its apply
   * step once, on the client, after the tree is live.
   */
  createEffect(
    () => undefined,
    () => {
      document.documentElement.dataset.hydrated = 'true'
    },
  )

  // Every page sits between the same header and footer. They read the session
  // from the context `beforeLoad` refreshes, so signing in or out changes them
  // without a reload.
  return (
    <div class="flex min-h-screen flex-col">
      <SiteHeader user={context().user} />
      <div class="flex flex-1 flex-col">
        <Outlet />
      </div>
      <SiteFooter user={context().user} />
    </div>
  )
}

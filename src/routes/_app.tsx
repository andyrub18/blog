import { createFileRoute, Outlet } from '@tanstack/solid-router'
import { fetchSessionUser } from '../lib/session'

/**
 * Pathless layout carrying the session.
 *
 * There is no `$lang` segment: Paraglide owns the locale. The middleware in
 * `src/server.ts` reads it from the URL, and the router de-localizes incoming
 * paths and localizes outgoing links (see `src/router.tsx`), so routes are
 * written once at their plain path.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async () => ({ user: await fetchSessionUser() }),
  component: AppLayout,
})

function AppLayout() {
  return <Outlet />
}

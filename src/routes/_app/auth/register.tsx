import { createFileRoute, Outlet } from '@tanstack/solid-router'
import { createServerFn } from '@tanstack/solid-start'

const ensureGuest = createServerFn({ method: 'GET' }).handler(async () => {
  const { redirectIfAuthenticated } = await import('../../../lib/session.server')

  await redirectIfAuthenticated()
})

/**
 * Layout for the registration flow.
 *
 * It must render an <Outlet />. Without one, `register.tsx` swallowed its own
 * children and `/auth/register/reader` and `/auth/register/member` rendered the
 * chooser instead of the forms — those two pages were unreachable. The chooser
 * itself now lives at `register/index.tsx`, where it belongs.
 */
export const Route = createFileRoute('/_app/auth/register')({
  beforeLoad: () => ensureGuest(),
  component: () => <Outlet />,
})

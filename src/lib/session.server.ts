import { redirect } from '@tanstack/solid-router'
import type { Role } from './db/schema'
import type { SessionUser } from './session'

/**
 * Server-only session helpers.
 *
 * Never import this module statically from anything a route can reach. It pulls
 * in Better Auth and, through it, every database adapter. Import it dynamically
 * from inside a server function or a route `beforeLoad` instead:
 *
 *   const { requireRole } = await import('../lib/session.server')
 */
export async function getSession() {
  const [{ getRequest }, { auth }] = await Promise.all([
    import('@tanstack/solid-start/server'),
    import('./auth'),
  ])
  const session = await auth.api.getSession({ headers: getRequest().headers })
  return session as { user: SessionUser; session: { id: string; userId: string } } | null
}

export async function requireUser(lang = 'fr'): Promise<SessionUser> {
  const session = await getSession()
  if (!session?.user) {
    throw redirect({ to: '/$lang/auth/login', params: { lang } })
  }
  return session.user
}

export async function requireRole(roles: Array<Role>, lang = 'fr'): Promise<SessionUser> {
  const user = await requireUser(lang)
  if (!roles.includes(user.role)) {
    throw redirect({ to: '/$lang', params: { lang } })
  }
  return user
}

export async function redirectIfAuthenticated(lang = 'fr'): Promise<void> {
  const session = await getSession()
  if (session?.user) {
    throw redirect({ to: '/$lang', params: { lang } })
  }
}

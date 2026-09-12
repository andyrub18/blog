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

export async function requireUser(): Promise<SessionUser> {
  const session = await getSession()
  if (!session?.user) {
    throw redirect({ to: '/auth/login' })
  }
  // Blocking deletes the person's sessions, so this should not normally be
  // reachable. It is the backstop for the window between a status change and a
  // cookie that has not yet been thrown away — the sign-in path explains the
  // refusal properly, in their language.
  if (session.user.memberStatus === 'blocked') {
    throw redirect({ to: '/auth/login' })
  }
  return session.user
}

export async function requireRole(roles: Array<Role>): Promise<SessionUser> {
  const user = await requireUser()
  if (!roles.includes(user.role)) {
    throw redirect({ to: '/' })
  }
  return user
}

export async function redirectIfAuthenticated(): Promise<void> {
  const session = await getSession()
  if (session?.user) {
    throw redirect({ to: '/' })
  }
}

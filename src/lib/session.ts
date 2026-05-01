import { redirect } from '@tanstack/solid-router'
import type { Role } from './db/schema'

export type SessionUser = {
  id: string
  email: string
  name: string
  emailVerified: boolean
  role: Role
  memberStatus: string
  image?: string | null
}

export async function getSession() {
  const [{ getRequest }, { auth }] = await Promise.all([
    import('@tanstack/solid-start/server'),
    import('./auth'),
  ])
  const session = await auth.api.getSession({
    headers: getRequest().headers,
  })
  return session as
    | { user: SessionUser; session: { id: string; userId: string } }
    | null
}

export async function requireUser(lang = 'fr'): Promise<SessionUser> {
  const session = await getSession()
  if (!session?.user) {
    throw redirect({ to: '/$lang/auth/login', params: { lang } })
  }
  return session.user
}

export async function requireRole(
  roles: Array<Role>,
  lang = 'fr',
): Promise<SessionUser> {
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


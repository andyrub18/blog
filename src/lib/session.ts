import { createServerFn } from '@tanstack/solid-start'
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

/**
 * Session for the router context. Runs on the server during SSR so the first
 * paint already knows who is signed in, and over the wire on client navigations.
 *
 * This module is imported by `routes/_app.tsx` and is therefore CLIENT code.
 * Everything that touches Better Auth lives in `session.server.ts`, which must
 * only ever be reached through a dynamic import inside a server boundary — a
 * static import would pull the whole auth server, with its kysely, sqlite and
 * postgres adapters, into the browser bundle (measured: ~136 KB gzipped).
 */
export const fetchSessionUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionUser | null> => {
    const { getSession } = await import('./session.server')
    const session = await getSession()
    return session?.user ?? null
  },
)

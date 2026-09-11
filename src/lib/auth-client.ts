import { createAuthClient } from 'better-auth/client'

/**
 * Framework-agnostic Better Auth client.
 *
 * We deliberately do NOT use `better-auth/solid`: its reactive `useSession()`
 * pins us to Solid 1, and a client-side session fetch means the first paint
 * renders as logged-out. The session is loaded server-side in the root route
 * instead (see `src/lib/session.ts` and `src/routes/__root.tsx`), so it is
 * present in the SSR payload. This client is only for imperative calls.
 */
export const authClient = createAuthClient()

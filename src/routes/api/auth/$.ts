import { createFileRoute } from '@tanstack/solid-router'

/**
 * Better Auth's HTTP handler.
 *
 * `auth` is imported lazily inside the handlers on purpose. This module is
 * referenced by the generated route tree, which is client code, so a top-level
 * import would drag the entire auth server — and its server-only dependencies
 * — into the browser bundle. Start's import protection rejects that outright:
 *
 *   [import-protection] Import denied in client environment
 *   Denied by specifier pattern: @tanstack/solid-start/server
 */
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { auth } = await import('../../../lib/auth')
        return auth.handler(request)
      },
      POST: async ({ request }) => {
        const { auth } = await import('../../../lib/auth')
        return auth.handler(request)
      },
    },
  },
})

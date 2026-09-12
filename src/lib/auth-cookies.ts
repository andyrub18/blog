import type { BetterAuthPlugin } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { parseSetCookieHeader } from 'better-auth/cookies'

/**
 * Forward Better Auth's `Set-Cookie` headers into the TanStack Start response.
 *
 * This is a local reimplementation of `better-auth/tanstack-start/solid`.
 *
 * Why not use the published one: that integration is built against TanStack
 * Start v1 (its peer range is `^1.0.0`) and reaches for
 * `@tanstack/solid-start/server` through a dynamic `import()`. Under Start 2 RC
 * that pulls the server-function handler into a build environment where the
 * `#tanstack-start-server-fn-resolver` virtual module is not registered, and
 * the production build fails outright with:
 *
 *   Missing "#tanstack-start-server-fn-resolver" specifier in "@tanstack/solid-start"
 *
 * A static import from a server-only module resolves cleanly. Delete this file
 * and go back to `tanstackStartCookies()` once Better Auth ships TanStack
 * Start 2 support.
 *
 * This plugin must be registered LAST, so it observes the response headers
 * every other plugin has already contributed.
 */
export function tanstackStartCookies(): BetterAuthPlugin {
  return {
    id: 'tanstack-start-cookies-solid-local',
    hooks: {
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            // Router-internal calls do not produce a client response.
            if ('_flag' in ctx && ctx._flag === 'router') return

            const headers = ctx.context.responseHeaders
            if (!(headers instanceof Headers)) return

            const setCookies = headers.get('set-cookie')
            if (!setCookies) return
            await forwardSetCookieHeader(setCookies)
          }),
        },
      ],
    },
  }
}

/**
 * Copy parsed `Set-Cookie` values onto the outgoing Start response.
 *
 * `@tanstack/solid-start/server` is imported lazily, inside the call, for two
 * separate reasons:
 *
 * 1. Client bundle. `lib/auth.ts` must not drag a server-only module into the
 *    browser graph; Start's import protection rejects that outright.
 * 2. Node scripts. A top-level import here made `lib/auth.ts` unloadable
 *    outside a request — `@tanstack/solid-start` pulls in solid-router, whose
 *    CatchBoundary throws "Client-only API called on the server side" the
 *    moment it is imported. That silently broke `npm run db:seed`, which does
 *    nothing but load `auth` and create a user.
 */
async function forwardSetCookieHeader(setCookies: string): Promise<void> {
  const { setCookie } = await import('@tanstack/solid-start/server')
  for (const [name, cookie] of parseSetCookieHeader(setCookies)) {
    if (!name) continue
    try {
      setCookie(name, cookie.value, {
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        maxAge: cookie['max-age'],
        secure: cookie.secure,
        httpOnly: cookie.httponly,
        sameSite: cookie.samesite,
      })
    } catch {
      // A cookie we cannot set is not worth failing the request over.
    }
  }
}

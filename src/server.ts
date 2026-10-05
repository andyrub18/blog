import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import handler from '@tanstack/solid-start/server-entry'
import { servedOverHttps } from './lib/auth/transport'
import { installNonceStore } from './lib/shared/csp-nonce'
import { withoutHeadBody } from './lib/shared/head-request'
import { securityHeaders, withSecurityHeaders } from './lib/shared/security-headers'
import { paraglideMiddleware } from './paraglide/server.js'

// The production guards run in `src/boot.ts`, a Nitro plugin, because this
// module is only loaded on the first request — too late to stop a misconfigured
// server from starting.

const production = process.env.NODE_ENV === 'production'
const https = servedOverHttps()

/**
 * Each request's CSP nonce, where `getRouter()` can read it (see
 * `lib/shared/csp-nonce.ts`). A fresh one per request: a nonce that repeats is a
 * password written on the page.
 */
const nonces = new AsyncLocalStorage<string>()
installNonceStore(nonces)

/**
 * Server entry.
 *
 * Every request runs inside Paraglide's AsyncLocalStorage scope, so `getLocale()`
 * — and therefore every `m.*()` call and the transactional email templates —
 * resolves to the right language per request. That isolation is the point: SSR
 * serves concurrent requests in different languages, and a module-level global
 * would leak one reader's language into another reader's page.
 *
 * The ORIGINAL request is forwarded, not the de-localized one Paraglide offers.
 * TanStack Router does its own de-localization through the `rewrite` option in
 * `src/router.tsx`; letting both rewrite would double-strip the prefix.
 *
 * Every response leaves with the security headers (`lib/shared/security-headers.ts`),
 * the CSP carrying the nonce the page's inline scripts were rendered with.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const nonce = production ? randomBytes(16).toString('base64') : undefined
    const run = () => paraglideMiddleware(request, () => handler.fetch(request))
    const response = await withoutHeadBody(
      request,
      nonce ? await nonces.run(nonce, run) : await run(),
    )
    return withSecurityHeaders(response, securityHeaders({ production, https, nonce }))
  },
}

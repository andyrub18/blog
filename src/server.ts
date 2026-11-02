import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { configureServerFunctionsServer } from '@solidjs/web/server-functions/server'
import handler from '@tanstack/solid-start/server-entry'
import { servedOverHttps } from './lib/auth/transport'
import { installNonceStore } from './lib/shared/csp-nonce'
import { withoutHeadBody } from './lib/shared/head-request'
import { sameHost } from './lib/shared/same-origin'
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
 * Every server function answers only this site's own pages — reads included.
 *
 * Solid checks where a call came from, but by default not for a GET, on the
 * premise that a read is safe to run from anywhere: another site cannot see the
 * answer. Ours are not all safe to run. `fetchApplication` and
 * `fetchProbationDue` write to the access log, so a link elsewhere could put a
 * senior's name in it. The only thing in the way was Paraglide redirecting the
 * navigation to a localized URL, which it does only for a browser that sends
 * `Sec-Fetch-Dest` (D37). Nothing we send is meant for a shared cache, so the
 * `Vary` the check adds costs nothing.
 *
 * `origin` compares hosts, for the reason `sameHost` gives; Solid's default
 * compares with `request.url`, which says `http://` behind Caddy.
 */
configureServerFunctionsServer({
  csrf: {
    protectDeclaredReads: true,
    origin: (origin, request) => sameHost(origin, request.url),
  },
})

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

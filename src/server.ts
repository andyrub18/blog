import handler from '@tanstack/solid-start/server-entry'
import { paraglideMiddleware } from './paraglide/server.js'

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
 */
export default {
  fetch(request: Request): Promise<Response> {
    return paraglideMiddleware(request, () => handler.fetch(request))
  },
}

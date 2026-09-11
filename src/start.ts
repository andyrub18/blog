import { createMiddleware, createStart } from '@tanstack/solid-start'

/**
 * Request middleware that makes the reader's locale ambient for the duration
 * of the request.
 *
 * Paraglide runs the handler inside an AsyncLocalStorage scope, so `getLocale()`
 * — and therefore every `m.*()` message call — resolves correctly on the server
 * without threading a locale through props. That isolation is the point: SSR
 * serves concurrent requests in different languages, and a module-level global
 * would leak one reader's language into another reader's page.
 *
 * Two deliberate details:
 *
 * 1. We call `next()` with the ORIGINAL request, ignoring the de-localized one
 *    Paraglide offers. TanStack Router owns URL localization here — routes live
 *    under `/$lang` — so letting Paraglide rewrite `/fr/atik` to `/atik` would
 *    hand the router a path it cannot match. Paraglide's own documentation
 *    calls this out for frameworks that localize URLs themselves.
 *
 * 2. Paraglide still answers an unprefixed document request (`/`) with a 307 to
 *    the reader's language, which is the same job `routes/index.tsx` does for
 *    client-side navigation. They agree because both read the `lang` cookie —
 *    see `src/i18n/paraglide-options.ts`.
 */
const localeMiddleware = createMiddleware({ type: 'request' }).server(
  async ({ request, next }) => {
    const { paraglideMiddleware } = await import('./paraglide/server.js')
    return await paraglideMiddleware(request, () => next())
  },
)

export const startInstance = createStart(() => ({
  requestMiddleware: [localeMiddleware],
}))

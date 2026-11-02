import { hydrate } from '@solidjs/web'
import { hydrateStart, StartClient } from '@tanstack/solid-start/client'

/**
 * The client entry: Start's default, with one step first.
 *
 * Paraglide matches URLs with `URLPattern`, and its runtime imports a polyfill
 * for it unconditionally — 6.1 KB gzipped on every page, for every reader,
 * including the ones whose browser has `URLPattern` built in, which on a phone
 * today is nearly all of them. `vite.config.ts` swaps that import for an empty
 * module in the client build, and the polyfill is fetched here instead, only
 * where it is missing (older Safari, older Firefox), before anything can match
 * a URL. Nothing in the runtime calls `URLPattern` while it loads — only inside
 * the functions the router calls once it exists — so waiting here is enough.
 *
 * `e2e/locales.spec.ts` deletes `URLPattern` from the page and checks that the
 * page still starts and still changes language.
 */
if (!('URLPattern' in globalThis)) {
  await import('urlpattern-polyfill')
}

hydrateStart().then((router) => {
  hydrate(() => <StartClient router={router} />, document)
})

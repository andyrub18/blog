/**
 * The current request's CSP nonce, for code that runs on both sides.
 *
 * `src/server.ts` makes a nonce for each request and runs the request inside an
 * `AsyncLocalStorage` holding it; `getRouter()` reads it here and passes it to
 * the router as `ssr.nonce`, which puts it on every inline script the server
 * renders. The router is built in shared code, which may not import server
 * modules (`node:async_hooks` among them), so the store is reached through
 * `globalThis` instead: on the server it is installed at boot, in the browser
 * it is never installed and the nonce is simply absent — the browser has no
 * inline scripts of its own to sign.
 */

type NonceStore = { getStore(): string | undefined }

const KEY = Symbol.for('klea.cspNonceStore')

export function installNonceStore(store: NonceStore): void {
  ;(globalThis as Record<symbol, unknown>)[KEY] = store
}

export function currentNonce(): string | undefined {
  const store = (globalThis as Record<symbol, NonceStore | undefined>)[KEY]
  return store?.getStore()
}

/**
 * Closing the database pool when the server stops.
 *
 * An open PostgreSQL connection keeps Node running after the HTTP server has
 * closed. Under systemd that made every deploy's restart wait out the stop
 * timeout — a minute and a half with the site down — before the old process
 * was killed and the new one could start. `src/boot.ts` calls `closeDatabase()`
 * from Nitro's `close` hook, which runs once srvx has let the requests in
 * flight finish.
 *
 * The pool registers itself here through `globalThis` rather than being
 * imported by the boot plugin, because the plugin and the app's server code are
 * bundled separately, each with its own copy of the modules it imports: a plugin
 * that imported `db` would close a pool of its own that never opened a
 * connection, and leave the app's open.
 */

type Close = () => Promise<void>

const KEY = Symbol.for('klea.closeDatabase')

export function onDatabaseClose(close: Close): void {
  ;(globalThis as Record<symbol, unknown>)[KEY] = close
}

export async function closeDatabase(): Promise<void> {
  const close = (globalThis as Record<symbol, Close | undefined>)[KEY]
  await close?.()
}

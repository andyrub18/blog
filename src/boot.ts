import { definePlugin } from 'nitro'
import { assertCaptchaConfigured } from './lib/auth/captcha'
import { assertClientIpHeader, assertSecureTransport } from './lib/auth/transport'
import { closeDatabase } from './lib/db/shutdown'
import { getMailer } from './lib/email/mailer'

/**
 * The production guards, run when the server starts — for real this time.
 *
 * They used to be called at the top of `src/server.ts`, commented "fail at
 * boot". But the built server loads that module on the first request, not at
 * startup: a misconfigured production server started, printed "Listening", and
 * answered every request with a 500. Safe — it failed closed — but invisible to
 * a process manager or a deploy's health check until somebody visited the site.
 * A Nitro plugin runs as the server starts, so a missing key or an insecure
 * setting stops it there, with the reason on the console.
 *
 * Each guard does nothing outside production, and `ALLOW_INSECURE_LOCAL=true`
 * lifts them — loudly — for a production build on a developer's machine.
 *
 * A refusal exits with 78 (`EX_CONFIG`), not with the 1 an ordinary crash
 * gives, so the service manager can tell the two apart: `deploy/klea.service`
 * restarts the server after a crash and gives up at once on 78 — restarting
 * cannot supply a missing key, and a loop of identical failures would bury the
 * one line that says which.
 */
const CONFIGURATION_ERROR_EXIT = 78

export default definePlugin((nitroApp) => {
  try {
    assertSecureTransport()
    assertClientIpHeader()
    assertCaptchaConfigured()
    // Chooses the transport, and refuses to in production without Resend keys.
    getMailer()
  } catch (err) {
    console.error(
      `\n[boot] Refusing to start: ${err instanceof Error ? err.message : err}\n`,
    )
    process.exit(CONFIGURATION_ERROR_EXIT)
  }

  // Without this the process outlives its HTTP server (see lib/db/shutdown.ts).
  nitroApp.hooks.hook('close', closeDatabase)
})

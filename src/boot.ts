import { definePlugin } from 'nitro'
import { assertCaptchaConfigured } from './lib/auth/captcha'
import { assertClientIpHeader, assertSecureTransport } from './lib/auth/transport'
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
 */
export default definePlugin(() => {
  assertSecureTransport()
  assertClientIpHeader()
  assertCaptchaConfigured()
  // Chooses the transport, and refuses to in production without Resend keys.
  getMailer()
})

/**
 * Cloudflare Turnstile verification.
 *
 * Turnstile rather than reCAPTCHA because it does not profile the visitor or
 * require solving image puzzles — most people are never challenged at all. For
 * a movement asking Haitians to hand over a CV, sending them through Google's
 * tracking to prove they are human is the wrong trade.
 *
 * Server-only: the secret key must never reach the browser.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type CaptchaResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'invalid' | 'unavailable' }

/** Whether a captcha is configured. Absent in development. */
export function captchaConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY)
}

/**
 * Verify a Turnstile token.
 *
 * When no secret is configured this returns ok, so local development works
 * without a Cloudflare account. `assertCaptchaConfigured()` is what stops that
 * leniency from reaching production.
 */
export async function verifyCaptcha(
  token: string | undefined | null,
  remoteIp?: string,
): Promise<CaptchaResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return { ok: true }

  if (!token) return { ok: false, reason: 'missing' }

  try {
    const body = new URLSearchParams({ secret, response: token })
    if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp)

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return { ok: false, reason: 'unavailable' }

    const data = (await response.json()) as {
      success?: boolean
      'error-codes'?: Array<string>
    }
    if (data.success) return { ok: true }

    // Never log the token itself; it is single-use but still a credential.
    console.warn(
      `[captcha] verification rejected: ${(data['error-codes'] ?? []).join(',')}`,
    )
    return { ok: false, reason: 'invalid' }
  } catch {
    // Cloudflare being unreachable must not become an open door OR a total
    // outage; the caller decides. We report it and let it fail closed.
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * Refuse to start in production without a captcha secret.
 *
 * Mirrors the mailer: a silently disabled bot defence looks identical to a
 * working one right up until the registration table fills with junk.
 */
export function assertCaptchaConfigured(): void {
  if (process.env.NODE_ENV === 'production' && !captchaConfigured()) {
    throw new Error(
      'TURNSTILE_SECRET_KEY must be set in production. Without it the ' +
        'registration endpoints have no bot defence.',
    )
  }
}

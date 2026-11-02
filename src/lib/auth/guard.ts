import type { RateLimitAction, RateLimitRule } from '../shared/rate-limit'

/**
 * Throttle and bot-check a request before it reaches Better Auth.
 *
 * Better Auth's own rate limiting and captcha plugin hook `onRequest`, so they
 * only cover traffic that arrives at `/api/auth/*`. These flows call
 * `auth.api.*` directly from a server function, which never touches that path —
 * so the protection has to live here or it does not exist at all.
 *
 * Its own module, imported inside each handler and never at the top of one.
 * Exported from `auth-actions.ts` so `password-reset-actions.ts` could share
 * it, it stayed in the browser's copy of that module, and its dynamic imports
 * — the rate limiter, the captcha check, through them the database — were
 * built as browser chunks. The reshuffle cost the reading view 0.6 KB.
 */
export async function guard(input: {
  action: RateLimitAction
  captchaToken?: string | null
  extraKey?: string
  extraRule?: RateLimitRule
}): Promise<
  { ok: true; ip: string } | { ok: false; code: 'RATE_LIMITED' | 'CAPTCHA_FAILED' }
> {
  const [{ getRequest }, { consume, clientIp, RULES: R }] = await Promise.all([
    import('@tanstack/solid-start/server'),
    import('../shared/rate-limit'),
  ])
  const headers = getRequest().headers
  const ip = clientIp(headers)

  const byIp = await consume(`${input.action}:ip:${ip}`, R[input.action])
  if (!byIp.allowed) return { ok: false, code: 'RATE_LIMITED' }

  if (input.extraKey && input.extraRule) {
    const extra = await consume(input.extraKey, input.extraRule)
    if (!extra.allowed) return { ok: false, code: 'RATE_LIMITED' }
  }

  if (input.captchaToken !== undefined) {
    const { verifyCaptcha } = await import('./captcha')
    const result = await verifyCaptcha(input.captchaToken, ip)
    if (!result.ok) return { ok: false, code: 'CAPTCHA_FAILED' }
  }

  return { ok: true, ip }
}

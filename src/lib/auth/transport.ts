/**
 * Whether the site is served over HTTPS, and the guard that insists on it in
 * production (SECURITY.md P0 #6).
 *
 * Better Auth marks its session cookie `secure` — and gives it the `__Secure-`
 * prefix — only when `BETTER_AUTH_URL` starts with `https://`. So a production
 * server configured with an `http://` address would hand out session cookies
 * that browsers send over plain HTTP, and nothing would look wrong. Refusing to
 * start is the same answer the mailer and the captcha give to a missing key: a
 * misconfiguration found at boot, not after the first member signs in on café
 * Wi-Fi. `ALLOW_INSECURE_LOCAL=true` lifts it for a production build on a
 * developer's machine, loudly, like the others.
 */

export function servedOverHttps(): boolean {
  return (process.env.BETTER_AUTH_URL ?? '').startsWith('https://')
}

export function assertSecureTransport(): void {
  if (process.env.NODE_ENV !== 'production' || servedOverHttps()) return
  if (process.env.ALLOW_INSECURE_LOCAL === 'true') {
    console.warn(
      '\n[transport] ALLOW_INSECURE_LOCAL is set: running a production build over ' +
        'plain HTTP. Session cookies are not marked secure. Never on a deployed server.\n',
    )
    return
  }
  throw new Error(
    'BETTER_AUTH_URL must be an https:// address in production: without it the ' +
      'session cookie is not marked secure. To run a production build locally, ' +
      'set ALLOW_INSECURE_LOCAL=true.',
  )
}

/**
 * Production must say which header carries the client's address, and it may not
 * be `x-forwarded-for` (see `clientIp` in `lib/shared/rate-limit.ts`).
 *
 * Without it every sign-in in the country shares one rate-limit bucket, so one
 * person guessing passwords locks everybody else out; with `x-forwarded-for`,
 * the first entry — which Better Auth's own limiter reads — is whatever the
 * client chose to write. Either way the limits that protect members' accounts
 * would not be doing their job, and nothing would show it.
 */
export function assertClientIpHeader(): void {
  if (process.env.NODE_ENV !== 'production') return
  const header = process.env.CLIENT_IP_HEADER?.trim().toLowerCase()
  if (header === 'x-forwarded-for') {
    throw new Error(
      'CLIENT_IP_HEADER must not be x-forwarded-for: its first entry is written by the ' +
        'client. Use a header the proxy sets, such as x-real-ip or cf-connecting-ip.',
    )
  }
  if (header) return
  if (process.env.ALLOW_INSECURE_LOCAL === 'true') {
    console.warn(
      '\n[transport] ALLOW_INSECURE_LOCAL is set and CLIENT_IP_HEADER is not: every ' +
        'caller shares one rate-limit bucket. Never on a deployed server.\n',
    )
    return
  }
  throw new Error(
    'CLIENT_IP_HEADER must name the header your reverse proxy sets to the client ' +
      'address (x-real-ip, or cf-connecting-ip behind Cloudflare). To run a ' +
      'production build locally, set ALLOW_INSECURE_LOCAL=true.',
  )
}

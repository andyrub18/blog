/**
 * The HTTP headers every response carries (SECURITY.md P0 #6, P3 #18).
 *
 * Pure: the caller says whether this is a production build served over HTTPS
 * and hands over the request's nonce; this returns the headers. `src/server.ts`
 * applies them to every response that has not set its own.
 *
 * **Content-Security-Policy, the one that can break things.** Scripts are
 * allowed from this origin, from Cloudflare's Turnstile (the registration
 * captcha — the only third-party script the site loads), and inline only when
 * they carry this request's nonce. Every inline script the server writes — the
 * hydration bootstrap and the serialized loader data — gets that nonce through
 * the router's `ssr.nonce`. There is no `'unsafe-inline'` for scripts: an
 * injected `<script>` in an article or a forum post, were one ever to get past
 * the renderers, would not run.
 *
 * Styles do allow `'unsafe-inline'`: the editor sets inline styles, and a style
 * attribute cannot run code. The difference between the two lines is
 * deliberate.
 *
 * Only applied to production builds. The dev server injects its own module
 * scripts without a nonce, and a policy that breaks `npm run dev` would be
 * switched off by the first person it annoyed. `e2e/csp.spec.ts` runs against a
 * production build for exactly that reason.
 */

export type SecurityHeaderOptions = {
  /** A production build. */
  production: boolean
  /** Served over HTTPS — what `BETTER_AUTH_URL` says. */
  https: boolean
  /** This request's CSP nonce; absent outside production. */
  nonce?: string
}

const TURNSTILE = 'https://challenges.cloudflare.com'

export function contentSecurityPolicy(options: {
  nonce: string
  https: boolean
}): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${options.nonce}' ${TURNSTILE}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `frame-src ${TURNSTILE}`,
    // Nobody may frame the site: a framed login page is how clickjacking asks
    // a member for their password on somebody else's page.
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    // Only over HTTPS: on a plain-HTTP local production run it would rewrite
    // every asset request to an address that does not answer.
    ...(options.https ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}

export function securityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    // Kept for browsers that predate `frame-ancestors`.
    'x-frame-options': 'DENY',
    /**
     * Nothing leaves the site in the Referer header. A reader following a link
     * out of an article would otherwise tell the destination which KLEA article
     * they were reading — for this movement's readers, that is exactly the kind
     * of trail confidentiality exists to avoid.
     */
    'referrer-policy': 'same-origin',
    'permissions-policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    'cross-origin-opener-policy': 'same-origin',
  }
  if (options.production && options.nonce) {
    headers['content-security-policy'] = contentSecurityPolicy({
      nonce: options.nonce,
      https: options.https,
    })
  }
  if (options.production && options.https) {
    // Two years, subdomains included. Not `preload`: that is a submission to
    // the browsers' built-in lists, hard to take back, and KLEA's to decide
    // once the domain and every subdomain are settled on HTTPS.
    headers['strict-transport-security'] = 'max-age=63072000; includeSubDomains'
  }
  return headers
}

/**
 * Add the headers a response does not already set. A route that chose its own —
 * the PDF downloads send a sandboxing CSP of their own — keeps its choice.
 */
export function withSecurityHeaders(
  response: Response,
  headers: Record<string, string>,
): Response {
  // A fresh Response, because some are handed over with immutable headers.
  const result = new Response(response.body, response)
  for (const [name, value] of Object.entries(headers)) {
    if (!result.headers.has(name)) result.headers.set(name, value)
  }
  return result
}

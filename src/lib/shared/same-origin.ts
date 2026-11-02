/**
 * Whether a request was sent by one of this site's own pages.
 *
 * The session cookie is `sameSite: 'lax'`, so a browser attaches it to any
 * top-level GET navigation — including one started by a link on somebody else's
 * site. Anything that does something on a GET with the caller's identity, like
 * writing to the access log, therefore needs to ask where the request came from
 * as well as who sent it (D37).
 *
 * `Sec-Fetch-Site` decides when the browser sends it, which every current one
 * does. `none` is refused with the rest: it is a URL typed, pasted or opened
 * from another program, and the link in an email is the attack. Older browsers
 * fall back to `Origin`, then `Referer`; ours always carries a same-origin
 * Referer (`Referrer-Policy: same-origin`), and a request with neither is
 * refused.
 */
export function sameOriginRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site !== null) return site === 'same-origin'
  const source = request.headers.get('origin') ?? request.headers.get('referer')
  return source !== null && sameHost(source, request.url)
}

/**
 * Compares hosts, not origins. Behind Caddy the app is reached over plain HTTP
 * and builds `request.url` as `http://<the visitor's Host>`, while the browser's
 * `Origin` says `https://`; an exact comparison would refuse every page of the
 * site. The host is what the proxy passes through unchanged.
 */
export function sameHost(source: string, requestUrl: string): boolean {
  try {
    return new URL(source).host === new URL(requestUrl).host
  } catch {
    // `Origin: null` — a sandboxed frame, a redirect across sites — is not a URL.
    return false
  }
}

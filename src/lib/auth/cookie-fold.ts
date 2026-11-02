/**
 * The `Cookie` header a request would carry if it were sent again after these
 * `Set-Cookie` headers: set ones replace, expired ones go.
 *
 * Pure, for `session.server.ts`: a session read later in the same request must
 * see the cookies this request has already changed (D40).
 */
export function foldSetCookies(
  cookie: string | null,
  setCookies: ReadonlyArray<string>,
): string {
  const jar = new Map<string, string>()
  for (const pair of (cookie ?? '').split(';')) {
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
  for (const setCookie of setCookies) {
    const [pair = '', ...attributes] = setCookie.split(';')
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const expired = attributes.some((attribute) => {
      const [key = '', value = ''] = attribute.split('=').map((part) => part.trim())
      if (key.toLowerCase() === 'max-age') return Number(value) <= 0
      if (key.toLowerCase() === 'expires') return Date.parse(value) <= Date.now()
      return false
    })
    if (expired) jar.delete(name)
    else jar.set(name, pair.slice(eq + 1).trim())
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

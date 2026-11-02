import { describe, expect, it } from 'vitest'
import { sameHost, sameOriginRequest } from './same-origin'

const URL_SEEN_BEHIND_CADDY = 'http://kleayiti.org/api/dossier/a/cv'

function request(headers: Record<string, string>): Request {
  return new Request(URL_SEEN_BEHIND_CADDY, { headers })
}

describe('sameOriginRequest', () => {
  it("accepts what the browser marks as this site's own", () => {
    expect(sameOriginRequest(request({ 'sec-fetch-site': 'same-origin' }))).toBe(true)
  })

  /** The link on another site, in an email, or pasted into the address bar. */
  it.each(['cross-site', 'same-site', 'none'])('refuses Sec-Fetch-Site: %s', (site) => {
    expect(sameOriginRequest(request({ 'sec-fetch-site': site }))).toBe(false)
  })

  it('believes Sec-Fetch-Site over a Referer that says otherwise', () => {
    const forged = request({
      'sec-fetch-site': 'cross-site',
      referer: 'https://kleayiti.org/fr/review',
    })
    expect(sameOriginRequest(forged)).toBe(false)
  })

  describe('in a browser that sends no Sec-Fetch-Site', () => {
    it('accepts a Referer from this site, over HTTPS though the app sees HTTP', () => {
      const ours = request({ referer: 'https://kleayiti.org/fr/review/a' })
      expect(sameOriginRequest(ours)).toBe(true)
    })

    it('accepts an Origin from this site', () => {
      expect(sameOriginRequest(request({ origin: 'https://kleayiti.org' }))).toBe(true)
    })

    it('refuses another site, including one whose name contains ours', () => {
      expect(sameOriginRequest(request({ referer: 'https://evil.test/' }))).toBe(false)
      expect(sameOriginRequest(request({ origin: 'https://notkleayiti.org' }))).toBe(
        false,
      )
      expect(
        sameOriginRequest(request({ origin: 'https://kleayiti.org.evil.test' })),
      ).toBe(false)
    })

    /** A link elsewhere can send nothing: that site sets its own Referrer-Policy. */
    it('refuses a request that says nothing about where it came from', () => {
      expect(sameOriginRequest(request({}))).toBe(false)
    })

    it('refuses Origin: null', () => {
      expect(sameOriginRequest(request({ origin: 'null' }))).toBe(false)
    })
  })
})

describe('sameHost', () => {
  it('counts the port as part of the host', () => {
    expect(sameHost('http://localhost:3000', 'http://localhost:3000/x')).toBe(true)
    expect(sameHost('http://localhost:4000', 'http://localhost:3000/x')).toBe(false)
  })
})

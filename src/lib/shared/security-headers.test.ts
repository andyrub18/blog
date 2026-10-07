import { describe, expect, it } from 'vitest'
import {
  contentSecurityPolicy,
  securityHeaders,
  withSecurityHeaders,
} from './security-headers'

describe('securityHeaders', () => {
  it('always refuses framing, sniffing and referrers leaving the site', () => {
    const headers = securityHeaders({ production: false, https: false })
    expect(headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin',
    })
  })

  /** The dev server's own scripts carry no nonce; a policy there would break it. */
  it('sends no CSP and no HSTS outside production', () => {
    const headers = securityHeaders({ production: false, https: true, nonce: 'n' })
    expect(headers['content-security-policy']).toBeUndefined()
    expect(headers['strict-transport-security']).toBeUndefined()
  })

  it('sends HSTS only over HTTPS', () => {
    expect(
      securityHeaders({ production: true, https: false, nonce: 'n' })[
        'strict-transport-security'
      ],
    ).toBeUndefined()
    expect(
      securityHeaders({ production: true, https: true, nonce: 'n' })[
        'strict-transport-security'
      ],
    ).toMatch(/^max-age=\d+; includeSubDomains$/)
  })
})

describe('contentSecurityPolicy', () => {
  const policy = contentSecurityPolicy({ nonce: 'abc123', https: true })
  const directive = (name: string) =>
    policy.split('; ').find((part) => part.startsWith(`${name} `) || part === name)

  /** The property that matters: an injected inline script does not run. */
  it('allows inline scripts only with the nonce', () => {
    expect(directive('script-src')).toBe(
      "script-src 'self' 'nonce-abc123' https://challenges.cloudflare.com",
    )
    expect(directive('script-src')).not.toContain('unsafe-inline')
    expect(directive('script-src')).not.toContain('unsafe-eval')
  })

  it('lets nobody frame the site, and no plugin run', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive('object-src')).toBe("object-src 'none'")
    expect(directive('base-uri')).toBe("base-uri 'self'")
  })

  it('upgrades insecure requests only when the site is on HTTPS', () => {
    expect(directive('upgrade-insecure-requests')).toBeDefined()
    expect(contentSecurityPolicy({ nonce: 'n', https: false })).not.toContain(
      'upgrade-insecure-requests',
    )
  })
})

describe('withSecurityHeaders', () => {
  it('keeps a header a route set for itself', async () => {
    const own = new Response('pdf', {
      headers: { 'content-security-policy': "sandbox; default-src 'none'" },
    })
    const result = withSecurityHeaders(own, {
      'content-security-policy': "default-src 'self'",
      'x-frame-options': 'DENY',
    })
    expect(result.headers.get('content-security-policy')).toBe(
      "sandbox; default-src 'none'",
    )
    expect(result.headers.get('x-frame-options')).toBe('DENY')
    expect(await result.text()).toBe('pdf')
  })

  it('works on a response whose headers are immutable', () => {
    const redirect = Response.redirect('https://example.org/', 302)
    const result = withSecurityHeaders(redirect, { 'x-frame-options': 'DENY' })
    expect(result.status).toBe(302)
    expect(result.headers.get('x-frame-options')).toBe('DENY')
  })
})

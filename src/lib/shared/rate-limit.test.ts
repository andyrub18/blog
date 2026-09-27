import { describe, expect, it } from 'vitest'
import { clientIp, RULES } from './rate-limit'

describe('clientIp', () => {
  /**
   * The property: an address the client writes is never the one used. A proxy
   * appends to `x-forwarded-for`, so its first entry is the client's own claim —
   * reading it gave every forged request a fresh rate-limit bucket.
   */
  it('reads only the header the proxy sets, never a client-written x-forwarded-for', () => {
    const headers = new Headers({
      'x-forwarded-for': '6.6.6.6',
      'x-real-ip': '41.87.1.1',
    })
    expect(clientIp(headers, 'x-real-ip')).toBe('41.87.1.1')
  })

  it('takes the last entry of a list, the one the nearest proxy wrote', () => {
    const headers = new Headers({ 'x-real-ip': '6.6.6.6, 41.87.1.1' })
    expect(clientIp(headers, 'x-real-ip')).toBe('41.87.1.1')
  })

  it('reads cf-connecting-ip when that is the header named', () => {
    expect(
      clientIp(new Headers({ 'cf-connecting-ip': ' 41.87.2.2 ' }), 'CF-Connecting-IP'),
    ).toBe('41.87.2.2')
  })

  it('returns a stable placeholder when no header is configured', () => {
    // Development: every caller shares one bucket. Must never be undefined,
    // which would collapse or crash the throttle key.
    expect(clientIp(new Headers({ 'x-forwarded-for': '41.87.1.1' }), undefined)).toBe(
      'unknown',
    )
  })

  it('returns the placeholder when the configured header is missing or empty', () => {
    expect(clientIp(new Headers(), 'x-real-ip')).toBe('unknown')
    expect(clientIp(new Headers({ 'x-real-ip': ' , ' }), 'x-real-ip')).toBe('unknown')
  })
})

describe('RULES', () => {
  it('is stricter for sign-up than for sign-in', () => {
    // Signing up repeatedly is never legitimate; mistyping a password is.
    expect(RULES.signUp.limit).toBeLessThan(RULES.signIn.limit)
  })

  it('windows every rule and never leaves one unbounded', () => {
    for (const [name, rule] of Object.entries(RULES)) {
      expect({ name, ok: rule.limit > 0 && rule.windowSeconds > 0 }).toEqual({
        name,
        ok: true,
      })
    }
  })

  it('gives the per-email sign-in counter a longer window than the per-IP one', () => {
    // Distributed credential stuffing against one member arrives from many
    // addresses, so the per-email window has to outlast the per-IP one.
    expect(RULES.signInPerEmail.windowSeconds).toBeGreaterThan(RULES.signIn.windowSeconds)
  })

  it('throttles verification resends, which would otherwise be a mail bomb', () => {
    expect(RULES.resendVerification.limit).toBeLessThanOrEqual(5)
  })
})

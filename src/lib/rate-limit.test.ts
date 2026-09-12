import { describe, expect, it } from 'vitest'
import { clientIp, RULES } from './rate-limit'

describe('clientIp', () => {
  it('takes the first entry of x-forwarded-for', () => {
    // The chain is client, proxy1, proxy2 — the client is the leftmost.
    const headers = new Headers({ 'x-forwarded-for': '41.87.1.1, 10.0.0.1, 10.0.0.2' })
    expect(clientIp(headers)).toBe('41.87.1.1')
  })

  it('trims whitespace', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '  41.87.1.1  ' }))).toBe(
      '41.87.1.1',
    )
  })

  it('falls back to cf-connecting-ip', () => {
    expect(clientIp(new Headers({ 'cf-connecting-ip': '41.87.2.2' }))).toBe('41.87.2.2')
  })

  it('falls back to x-real-ip', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '41.87.3.3' }))).toBe('41.87.3.3')
  })

  it('prefers x-forwarded-for over the others', () => {
    const headers = new Headers({
      'x-forwarded-for': '41.87.1.1',
      'cf-connecting-ip': '41.87.2.2',
      'x-real-ip': '41.87.3.3',
    })
    expect(clientIp(headers)).toBe('41.87.1.1')
  })

  it('returns a stable placeholder when no address is present', () => {
    // Must never return undefined: that would make the throttle key collapse
    // and bucket every anonymous request together, or crash the lookup.
    expect(clientIp(new Headers())).toBe('unknown')
  })

  it('ignores an empty x-forwarded-for', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '' }))).toBe('unknown')
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

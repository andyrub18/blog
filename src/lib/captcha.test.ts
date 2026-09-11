import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCaptchaConfigured, captchaConfigured, verifyCaptcha } from './captcha'

const ORIGINAL = { ...process.env }

beforeEach(() => {
  vi.restoreAllMocks()
  process.env = { ...ORIGINAL }
})
afterEach(() => {
  process.env = { ...ORIGINAL }
  vi.unstubAllGlobals()
})

function mockVerify(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('captchaConfigured', () => {
  it('is false without a secret', () => {
    delete process.env.TURNSTILE_SECRET_KEY
    expect(captchaConfigured()).toBe(false)
  })
})

describe('verifyCaptcha', () => {
  it('passes through when no secret is configured, so local dev works', async () => {
    delete process.env.TURNSTILE_SECRET_KEY
    await expect(verifyCaptcha(undefined)).resolves.toEqual({ ok: true })
  })

  it('rejects a missing token once a secret is configured', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    await expect(verifyCaptcha(undefined)).resolves.toEqual({
      ok: false,
      reason: 'missing',
    })
  })

  it('accepts a token Cloudflare confirms', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    mockVerify({ success: true })
    await expect(verifyCaptcha('token')).resolves.toEqual({ ok: true })
  })

  it('rejects a token Cloudflare refuses', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockVerify({ success: false, 'error-codes': ['invalid-input-response'] })
    await expect(verifyCaptcha('token')).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  // Failing open would turn a Cloudflare outage into an open registration door.
  it('fails closed when Cloudflare is unreachable', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    await expect(verifyCaptcha('token')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    })
  })

  it('fails closed on a non-200 from Cloudflare', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    mockVerify({}, false)
    await expect(verifyCaptcha('token')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    })
  })

  it('never sends the secret anywhere but Cloudflare', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    const fetchMock = mockVerify({ success: true })
    await verifyCaptcha('token', '41.87.1.1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(String((init as { body: URLSearchParams }).body)).toContain(
      'remoteip=41.87.1.1',
    )
  })

  it('omits an unknown client address rather than sending the literal string', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    const fetchMock = mockVerify({ success: true })
    await verifyCaptcha('token', 'unknown')
    const [, init] = fetchMock.mock.calls[0]
    expect(String((init as { body: URLSearchParams }).body)).not.toContain('remoteip')
  })
})

describe('assertCaptchaConfigured', () => {
  it('refuses to start in production without a secret', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.TURNSTILE_SECRET_KEY
    expect(() => assertCaptchaConfigured()).toThrowError(/TURNSTILE_SECRET_KEY/)
  })

  it('allows development without a secret', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.TURNSTILE_SECRET_KEY
    expect(() => assertCaptchaConfigured()).not.toThrow()
  })
})

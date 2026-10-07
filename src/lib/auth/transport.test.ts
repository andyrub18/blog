import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertClientIpHeader, assertSecureTransport } from './transport'

describe('assertSecureTransport', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  /**
   * An http:// address in production means session cookies without `secure`,
   * which nothing on the page would reveal. It has to stop the server instead.
   */
  it('refuses to start production over plain HTTP', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETTER_AUTH_URL', 'http://klea.example')
    vi.stubEnv('ALLOW_INSECURE_LOCAL', '')
    expect(() => assertSecureTransport()).toThrow(/https:\/\//)
  })

  it('starts production over HTTPS', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETTER_AUTH_URL', 'https://kleayiti.com')
    expect(() => assertSecureTransport()).not.toThrow()
  })

  it('lets a local production build run over HTTP when told to, and says so', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
    vi.stubEnv('ALLOW_INSECURE_LOCAL', 'true')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => assertSecureTransport()).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })

  it('does not stand in the way of development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
    expect(() => assertSecureTransport()).not.toThrow()
  })
})

describe('assertClientIpHeader', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('refuses to start production without a client address header', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLIENT_IP_HEADER', '')
    vi.stubEnv('ALLOW_INSECURE_LOCAL', '')
    expect(() => assertClientIpHeader()).toThrow(/CLIENT_IP_HEADER/)
  })

  /** Its first entry is the client's own claim — the bypass this closes. */
  it('refuses x-forwarded-for, whatever the case', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLIENT_IP_HEADER', 'X-Forwarded-For')
    expect(() => assertClientIpHeader()).toThrow(/must not be x-forwarded-for/)
  })

  it('starts with a header the proxy sets', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLIENT_IP_HEADER', 'x-real-ip')
    expect(() => assertClientIpHeader()).not.toThrow()
  })
})

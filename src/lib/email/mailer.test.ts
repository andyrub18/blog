import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConsoleMailer, getMailer, resetMailer } from './mailer'

const ORIGINAL = { ...process.env }

beforeEach(() => {
  resetMailer()
  vi.restoreAllMocks()
})

afterEach(() => {
  process.env = { ...ORIGINAL }
  resetMailer()
})

describe('createConsoleMailer', () => {
  it('reports success and prints the message', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const mailer = createConsoleMailer()
    const result = await mailer.send({
      to: 'lekte@kle.ht',
      subject: 'Subject',
      html: '<p>hi</p>',
      text: 'hi',
    })
    expect(result).toEqual({ ok: true })
    expect(info).toHaveBeenCalledOnce()
    expect(String(info.mock.calls[0][0])).toContain('lekte@kle.ht')
  })
})

describe('getMailer', () => {
  it('falls back to the console transport in development', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_FROM
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getMailer()).toBeDefined()
  })

  // The failure this prevents: shipping to production with no provider
  // configured, where every signup silently never receives its link.
  it('refuses to start in production without credentials', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_FROM
    expect(() => getMailer()).toThrowError(/RESEND_API_KEY/)
  })

  it('refuses in production when only the API key is set', () => {
    process.env.NODE_ENV = 'production'
    process.env.RESEND_API_KEY = 're_test'
    delete process.env.EMAIL_FROM
    expect(() => getMailer()).toThrowError(/EMAIL_FROM/)
  })

  it('uses Resend when both credentials are present', () => {
    process.env.NODE_ENV = 'production'
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_FROM = 'KLE <noreply@kle.ht>'
    expect(() => getMailer()).not.toThrow()
  })

  it('memoises the transport', () => {
    process.env.NODE_ENV = 'development'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getMailer()).toBe(getMailer())
  })
})

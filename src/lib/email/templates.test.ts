import { describe, expect, it } from 'vitest'
import { renderPasswordResetEmail, renderVerificationEmail } from './templates'

const URL_ = 'https://kleayiti.com/api/auth/verify-email?token=abc123'

describe('renderVerificationEmail', () => {
  it('renders in French', () => {
    const mail = renderVerificationEmail({ name: 'Anderson', url: URL_, locale: 'fr' })
    expect(mail.subject).toContain('Vérifiez')
    expect(mail.html).toContain('Bonjour Anderson')
    expect(mail.text).toContain('Bonjour Anderson')
  })

  it('renders in Creole — a Creole reader must not get a French email', () => {
    const mail = renderVerificationEmail({ name: 'Anderson', url: URL_, locale: 'ht' })
    expect(mail.subject).toContain('Verifye')
    expect(mail.html).toContain('Bonjou Anderson')
    expect(mail.html).not.toContain('Bonjour ')
  })

  it('sets the document language so mail clients read it correctly', () => {
    expect(
      renderVerificationEmail({ name: 'A', url: URL_, locale: 'ht' }).html,
    ).toContain('lang="ht"')
  })

  it('includes the verification link in both the button and as plain text', () => {
    const mail = renderVerificationEmail({ name: 'A', url: URL_, locale: 'fr' })
    expect(mail.html).toContain(`href="${URL_.replace(/&/g, '&amp;')}"`)
    expect(mail.text).toContain(URL_)
  })

  it('always ships a plain-text alternative', () => {
    const mail = renderVerificationEmail({ name: 'A', url: URL_, locale: 'fr' })
    expect(mail.text.length).toBeGreaterThan(40)
    expect(mail.text).not.toContain('<')
  })

  // Names arrive from public registration and are therefore untrusted.
  it('escapes a hostile display name', () => {
    const mail = renderVerificationEmail({
      name: '<img src=x onerror="alert(1)">',
      url: URL_,
      locale: 'fr',
    })
    // The property that matters is that nothing is executable: no raw tag, and
    // no attribute that a parser could read. The literal text `onerror=` may
    // still appear inside escaped content, which is inert.
    expect(mail.html).not.toContain('<img')
    expect(mail.html).not.toContain('onerror="')
    expect(mail.html).toContain('&lt;img')
    expect(mail.html).toContain('onerror=&quot;')
  })

  it('escapes a hostile URL rather than breaking out of the attribute', () => {
    const mail = renderVerificationEmail({
      name: 'A',
      url: 'https://kleayiti.com/?a="><script>alert(1)</script>',
      locale: 'fr',
    })
    expect(mail.html).not.toContain('<script>')
  })

  it('loads no remote resources, so it cannot confirm an address is live', () => {
    const mail = renderVerificationEmail({ name: 'A', url: URL_, locale: 'fr' })
    expect(mail.html).not.toMatch(/<img\s/i)
    expect(mail.html).not.toContain('fonts.googleapis.com')
  })

  it('escapes an ampersand in the token so the link survives HTML parsing', () => {
    const mail = renderVerificationEmail({
      name: 'A',
      url: 'https://kleayiti.com/v?token=a&callback=b',
      locale: 'fr',
    })
    expect(mail.html).toContain('token=a&amp;callback=b')
  })
})

describe('renderPasswordResetEmail', () => {
  const RESET_URL =
    'https://kleayiti.com/api/auth/reset-password/tok?callbackURL=%2Fht%2Fauth%2Freset-password'

  it('renders in the language it was asked in', () => {
    const mail = renderPasswordResetEmail({
      name: 'Anderson',
      url: RESET_URL,
      locale: 'ht',
    })
    expect(mail.subject).toContain('modpas')
    expect(mail.html).toContain('Bonjou Anderson')
    expect(mail.html).toContain('lang="ht"')
  })

  it('carries the link in the button and as plain text', () => {
    const mail = renderPasswordResetEmail({ name: 'A', url: RESET_URL, locale: 'fr' })
    expect(mail.html).toContain(`href="${RESET_URL}"`)
    expect(mail.text).toContain(RESET_URL)
    expect(mail.text).not.toContain('<')
  })

  /**
   * Anybody can ask for a reset in somebody else's name. The person who gets
   * one they did not ask for has to be told that nothing changes unless they
   * use it, and that the link does not last.
   */
  it('says the link expires and can be ignored', () => {
    const mail = renderPasswordResetEmail({ name: 'A', url: RESET_URL, locale: 'fr' })
    expect(mail.text).toContain('une heure')
    expect(mail.text).toContain('ne change pas')
  })

  it('escapes a hostile display name', () => {
    const mail = renderPasswordResetEmail({
      name: '<img src=x onerror="alert(1)">',
      url: RESET_URL,
      locale: 'fr',
    })
    expect(mail.html).not.toContain('<img')
    expect(mail.html).toContain('&lt;img')
  })
})

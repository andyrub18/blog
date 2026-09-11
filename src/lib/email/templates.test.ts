import { describe, expect, it } from 'vitest'
import { renderVerificationEmail } from './templates'

const URL_ = 'https://kle.ht/api/auth/verify-email?token=abc123'

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
      url: 'https://kle.ht/?a="><script>alert(1)</script>',
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
      url: 'https://kle.ht/v?token=a&callback=b',
      locale: 'fr',
    })
    expect(mail.html).toContain('token=a&amp;callback=b')
  })
})

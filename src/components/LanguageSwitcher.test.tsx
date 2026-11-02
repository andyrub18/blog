import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setLocale = vi.fn()
let currentLocale = 'fr'
let location = { pathname: '/fr/auth/login', searchStr: '' }

vi.mock('@tanstack/solid-router', () => ({
  useLocation: () => () => location,
}))

// Partial mock: the compiled messages import other runtime exports, so
// replacing the whole module breaks them.
vi.mock('../paraglide/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../paraglide/runtime')>()),
  getLocale: () => currentLocale,
  setLocale: (...args: Array<unknown>) => setLocale(...args),
}))

const { default: LanguageSwitcher } = await import('./LanguageSwitcher')

/** jsdom cannot follow a link; the browser's half of the click is not under test. */
const stayPut = (event: Event) => event.preventDefault()

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    setLocale.mockClear()
    currentLocale = 'fr'
    location = { pathname: '/fr/auth/login', searchStr: '' }
    document.addEventListener('click', stayPut)
  })
  afterEach(() => document.removeEventListener('click', stayPut))

  it('offers every supported language by its own name', () => {
    render(() => <LanguageSwitcher />)
    for (const name of ['Français', 'Kreyòl', 'English', 'Español']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
  })

  it('marks the active language for assistive technology', () => {
    render(() => <LanguageSwitcher />)
    expect(screen.getByRole('link', { name: 'Français' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('link', { name: 'Kreyòl' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('links to the same page in the other language', () => {
    render(() => <LanguageSwitcher />)
    // /fr/auth/login -> /ht/auth/login, not back to the home page, and not
    // /ht/fr/auth/login — the old prefix must be stripped before the new one.
    // Real deLocalizeHref/localizeHref run here, so this exercises the actual
    // URL patterns from src/i18n/paraglide-options.ts.
    expect(screen.getByRole('link', { name: 'Kreyòl' })).toHaveAttribute(
      'href',
      '/ht/auth/login',
    )
  })

  it('keeps the query string, so an invitation survives a change of language', () => {
    location = { pathname: '/fr/auth/register/invited', searchStr: '?token=abc123' }
    render(() => <LanguageSwitcher />)
    expect(screen.getByRole('link', { name: 'Español' })).toHaveAttribute(
      'href',
      '/es/auth/register/invited?token=abc123',
    )
  })

  it('remembers the choice for the next unprefixed visit', async () => {
    const user = userEvent.setup()
    render(() => <LanguageSwitcher />)
    await user.click(screen.getByRole('link', { name: 'Kreyòl' }))

    expect(setLocale).toHaveBeenCalledWith('ht', { reload: false })
  })

  it('does nothing when the active language is chosen again', async () => {
    const user = userEvent.setup()
    render(() => <LanguageSwitcher />)
    await user.click(screen.getByRole('link', { name: 'Français' }))

    expect(setLocale).not.toHaveBeenCalled()
  })
})

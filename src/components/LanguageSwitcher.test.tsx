import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
const setLocale = vi.fn()
let currentLocale = 'fr'

vi.mock('@tanstack/solid-router', () => ({
  useRouter: () => ({ history: { push } }),
  useLocation: () => () => ({ pathname: '/fr/auth/login' }),
}))

// Partial mock: the compiled messages import other runtime exports, so
// replacing the whole module breaks them.
vi.mock('../paraglide/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../paraglide/runtime')>()),
  getLocale: () => currentLocale,
  setLocale: (...args: Array<unknown>) => setLocale(...args),
}))

const { default: LanguageSwitcher } = await import('./LanguageSwitcher')

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    push.mockClear()
    setLocale.mockClear()
    currentLocale = 'fr'
  })

  it('offers every supported language by its own name', () => {
    render(() => <LanguageSwitcher />)
    expect(screen.getByRole('button', { name: 'Français' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kreyòl' })).toBeInTheDocument()
  })

  it('marks the active language for assistive technology', () => {
    render(() => <LanguageSwitcher />)
    expect(screen.getByRole('button', { name: 'Français' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Kreyòl' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('keeps the reader on the same page when switching language', async () => {
    const user = userEvent.setup()
    render(() => <LanguageSwitcher />)
    await user.click(screen.getByRole('button', { name: 'Kreyòl' }))

    expect(setLocale).toHaveBeenCalledWith('ht', { reload: false })
    // /fr/auth/login -> /ht/auth/login, not back to the home page, and not
    // /ht/fr/auth/login — the old prefix must be stripped before the new one.
    // Real deLocalizeHref/localizeHref run here, so this exercises the actual
    // URL patterns from src/i18n/paraglide-options.ts.
    expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/ht\/auth\/login$/))
  })

  it('does nothing when the active language is chosen again', async () => {
    const user = userEvent.setup()
    render(() => <LanguageSwitcher />)
    await user.click(screen.getByRole('button', { name: 'Français' }))

    expect(setLocale).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })
})

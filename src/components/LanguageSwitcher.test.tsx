import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()
const setLocaleCookie = vi.fn().mockResolvedValue({ ok: true })

vi.mock('@tanstack/solid-router', () => ({
  useRouter: () => ({ history: { push: navigate } }),
  useLocation: () => () => ({ pathname: '/fr/auth/login' }),
}))

vi.mock('../i18n/detect', () => ({
  setLocaleCookie: (...args: Array<unknown>) => setLocaleCookie(...args),
}))

vi.mock('../i18n/context', () => ({
  useLocale: () => () => 'fr',
}))

const { default: LanguageSwitcher } = await import('./LanguageSwitcher')

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    navigate.mockClear()
    setLocaleCookie.mockClear()
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

    expect(setLocaleCookie).toHaveBeenCalledWith({ data: { locale: 'ht' } })
    // /fr/auth/login -> /ht/auth/login, not back to the home page.
    expect(navigate).toHaveBeenCalledWith('/ht/auth/login')
  })

  it('does nothing when the active language is chosen again', async () => {
    const user = userEvent.setup()
    render(() => <LanguageSwitcher />)
    await user.click(screen.getByRole('button', { name: 'Français' }))

    expect(setLocaleCookie).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})

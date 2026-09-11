import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const applyForMembership = vi.fn()
const invalidate = vi.fn()

vi.mock('@tanstack/solid-router', () => ({
  useRouter: () => ({ invalidate }),
}))

vi.mock('../../lib/auth-actions', () => ({
  applyForMembership: (...args: Array<unknown>) => applyForMembership(...args),
}))

const { default: ApplyForm } = await import('./ApplyForm')

function field(name: string) {
  return document.querySelector<HTMLElement>(`[name="${name}"]`)
}

describe('ApplyForm', () => {
  beforeEach(() => {
    applyForMembership.mockReset()
    invalidate.mockReset()
  })

  /**
   * The point of the promotion path: collect what is missing, and only what is
   * missing. A reader already gave their name, email, date of birth and a short
   * essay at registration; asking again would be both rude and a second copy of
   * personal data to protect.
   */
  it('asks for the dossier the account does not already have', () => {
    render(() => <ApplyForm />)
    expect(field('cv')).toBeInTheDocument()
    expect(field('vision')).toBeInTheDocument()
    expect(field('contribution')).toBeInTheDocument()
    expect(field('contributionPlan')).toBeInTheDocument()
  })

  it('does not re-ask for anything the account already holds', () => {
    render(() => <ApplyForm />)
    for (const name of ['name', 'email', 'password', 'dateOfBirth', 'essay']) {
      expect({ name, present: field(name) !== null }).toEqual({ name, present: false })
    }
  })

  it('accepts only PDFs for each dossier file', () => {
    render(() => <ApplyForm />)
    for (const name of ['cv', 'vision', 'contribution']) {
      expect(field(name)).toHaveAttribute('type', 'file')
      expect(field(name)).toHaveAttribute('accept', 'application/pdf')
    }
  })

  it('labels every file input for screen readers', () => {
    render(() => <ApplyForm />)
    expect(screen.getByLabelText(/CV/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Vision pour le pays/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Comment vous contribuerez/i)).toBeInTheDocument()
  })

  it('refuses an empty submission without calling the server', async () => {
    const user = userEvent.setup()
    render(() => <ApplyForm />)
    await user.click(screen.getByRole('button', { name: /Déposer ma candidature/i }))

    expect(applyForMembership).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0)
  })

  it('rejects a contribution plan that is too short to evaluate', async () => {
    const user = userEvent.setup()
    render(() => <ApplyForm />)
    await user.type(field('contributionPlan') as HTMLTextAreaElement, 'Too short.')
    await user.click(screen.getByRole('button', { name: /Déposer ma candidature/i }))

    expect(field('contributionPlan')).toHaveAttribute('aria-invalid', 'true')
    expect(applyForMembership).not.toHaveBeenCalled()
  })

  /**
   * The successful multi-file submission is NOT covered here.
   *
   * jsdom's `FormData` returns a real `File` for a file input but with
   * `size: 0` — it does not carry the bytes through, even though
   * `input.files[0].size` is correct. Our validation rejects a zero-byte
   * upload, correctly, so the happy path cannot be reached in this
   * environment. Weakening that check to satisfy jsdom would remove a real
   * guard, so the submit-and-succeed path belongs in an e2e test against a
   * real browser, once there is a seeded reader account to sign in as.
   */
})

import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resendVerificationEmail = vi.fn()

vi.mock('../../lib/auth-actions', () => ({
  resendVerificationEmail: (...args: Array<unknown>) => resendVerificationEmail(...args),
}))

const { default: VerifyEmailNotice } = await import('./VerifyEmailNotice')

/**
 * The panel that stands between a new account and the only door into it.
 *
 * Everything here is about the case the platform used to have no answer for: an
 * account that exists whose verification email did not go out. That path is
 * reachable by a Resend outage and by nothing an author does, so it cannot be
 * covered end to end — which is exactly why it is worth pinning here.
 */
describe('VerifyEmailNotice', () => {
  beforeEach(() => {
    resendVerificationEmail.mockReset()
  })

  it('says the mail is on its way when it was accepted', () => {
    render(() => (
      <VerifyEmailNotice email="a@b.test" verificationSent={true} onLogin={() => {}} />
    ))
    expect(screen.getByText(/courriel de vérification a été envoyé/i)).toBeInTheDocument()
    expect(screen.queryByText(/n'a pas pu être envoyé/i)).not.toBeInTheDocument()
  })

  /**
   * Both halves of the truth, together. "Created" alone hides an undelivered
   * email; "failed" alone hides an account whose address can no longer be
   * registered.
   */
  it('still reports the account as created when the mail did not go out', () => {
    render(() => (
      <VerifyEmailNotice email="a@b.test" verificationSent={false} onLogin={() => {}} />
    ))
    expect(screen.getByText(/Compte créé/i)).toBeInTheDocument()
    expect(screen.getByText(/n'a pas pu être envoyé/i)).toBeInTheDocument()
  })

  /**
   * Offered either way. A mailer that accepted the message has not delivered it,
   * and a spam folder looks exactly like an outage from where the reader sits.
   */
  it.each([true, false])('offers the resend control when sent=%s', (sent) => {
    render(() => (
      <VerifyEmailNotice email="a@b.test" verificationSent={sent} onLogin={() => {}} />
    ))
    expect(
      screen.getByRole('button', { name: /Renvoyer le courriel de vérification/i }),
    ).toBeInTheDocument()
  })

  it('asks for the mail again for the address that registered', async () => {
    resendVerificationEmail.mockResolvedValue({ ok: true })
    render(() => (
      <VerifyEmailNotice
        email="someone@example.test"
        verificationSent={false}
        onLogin={() => {}}
      />
    ))

    await userEvent.click(
      screen.getByRole('button', { name: /Renvoyer le courriel de vérification/i }),
    )

    expect(resendVerificationEmail).toHaveBeenCalledWith({
      data: { email: 'someone@example.test' },
    })
    expect(await screen.findByText(/Courriel envoyé/i)).toBeInTheDocument()
  })

  /**
   * A refusal is reported as one. `resendVerificationEmail` returns `ok: false`
   * when the throttle refuses as well as when the mailer does, and telling
   * somebody to wait a few minutes is true of both.
   */
  it('reports a refused resend rather than claiming it was sent', async () => {
    resendVerificationEmail.mockResolvedValue({ ok: false })
    render(() => (
      <VerifyEmailNotice email="a@b.test" verificationSent={true} onLogin={() => {}} />
    ))

    await userEvent.click(
      screen.getByRole('button', { name: /Renvoyer le courriel de vérification/i }),
    )

    expect(await screen.findByText(/L'envoi a échoué/i)).toBeInTheDocument()
    expect(screen.queryByText(/Courriel envoyé/i)).not.toBeInTheDocument()
  })

  it('reports a resend that threw the same way as one that was refused', async () => {
    resendVerificationEmail.mockRejectedValue(new Error('network'))
    render(() => (
      <VerifyEmailNotice email="a@b.test" verificationSent={true} onLogin={() => {}} />
    ))

    await userEvent.click(
      screen.getByRole('button', { name: /Renvoyer le courriel de vérification/i }),
    )

    expect(await screen.findByText(/L'envoi a échoué/i)).toBeInTheDocument()
  })

  it('passes the extra hint through for the flow that has one', () => {
    render(() => (
      <VerifyEmailNotice
        email="a@b.test"
        verificationSent={true}
        extraHint="Votre candidature sera examinée."
        onLogin={() => {}}
      />
    ))
    expect(screen.getByText(/Votre candidature sera examinée/i)).toBeInTheDocument()
  })
})

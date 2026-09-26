import { Show } from 'solid-js'
import { m } from '../../paraglide/messages'
import ResendVerification from './ResendVerification'

/**
 * What every completed registration shows: the account exists, go and verify it.
 *
 * Shared by the three registration forms so they cannot drift, and so the way
 * out of a missing verification email is offered by all of them.
 *
 * The resend control is offered whether or not the first mail went out, because
 * "sent" only ever means the mailer accepted it.
 */
export default function VerifyEmailNotice(props: {
  email: string
  /** False when the account was created but the verification mail did not go out. */
  verificationSent: boolean
  /** Anything this particular flow has to add — what happens to an application, say. */
  extraHint?: string
  onLogin: () => void
}) {
  return (
    <div class="flex flex-col items-center gap-4 text-center">
      <h2 class="text-lg font-semibold text-neutral-900">
        {m.auth_register_success_title()}
      </h2>
      <p class="text-sm text-neutral-700">
        {props.verificationSent
          ? m.auth_register_success_verifyHint()
          : m.auth_register_success_verifyFailedHint()}
      </p>
      <Show when={props.extraHint}>
        {(hint) => <p class="text-sm text-neutral-700">{hint()}</p>}
      </Show>

      <ResendVerification email={props.email} />

      <button
        type="button"
        onClick={props.onLogin}
        class="h-11 rounded-md bg-[#00209F] px-4 text-sm font-semibold text-white hover:opacity-95"
      >
        {m.auth_verify_goLogin()}
      </button>
    </div>
  )
}

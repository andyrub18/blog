import { createSignal, Show } from 'solid-js'
import { resendVerificationEmail } from '../../lib/auth-actions'
import { m } from '../../paraglide/messages'

type ResendState = 'idle' | 'sending' | 'sent' | 'failed'

/**
 * Ask for the verification email again.
 *
 * Verification is the only door into a new account, and it is held open by one
 * email — which can fail to send, land in a spam folder, or arrive at an address
 * the person cannot reach today. Without this, any of those strands somebody
 * permanently: the address is taken, so they cannot register a second time, and
 * there is nothing on the page to press. `resendVerificationEmail` had existed
 * and been rate-limited all along; nothing called it.
 *
 * Shown in the two places a person notices the mail is missing: on the
 * confirmation panel right after registering, and on the sign-in form when an
 * unverified account is refused.
 */
export default function ResendVerification(props: { email: string }) {
  const [state, setState] = createSignal<ResendState>('idle')

  async function resend() {
    setState('sending')
    try {
      const result = await resendVerificationEmail({ data: { email: props.email } })
      setState(result.ok ? 'sent' : 'failed')
    } catch {
      setState('failed')
    }
  }

  return (
    <div class="flex flex-col items-center gap-1">
      <button
        type="button"
        disabled={state() === 'sending'}
        onClick={() => void resend()}
        class="text-sm font-medium text-[#00209F] hover:underline disabled:opacity-60"
      >
        {state() === 'sending' ? m.auth_verify_resending() : m.auth_verify_resend()}
      </button>
      <div aria-live="polite" class="min-h-5 text-sm">
        <Show when={state() === 'sent'}>
          <p class="text-neutral-600">{m.auth_verify_resendSent()}</p>
        </Show>
        <Show when={state() === 'failed'}>
          <p class="text-[#D21034]">{m.auth_verify_resendFailed()}</p>
        </Show>
      </div>
    </div>
  )
}

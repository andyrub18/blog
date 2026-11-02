import { Link } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { requestPasswordReset } from '../../lib/auth/password-reset-actions'
import { isValidEmail } from '../../lib/shared/validation'
import { m } from '../../paraglide/messages'

const INPUT_CLASS =
  'h-11 px-3 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20'

/**
 * Ask for a reset link.
 *
 * Whatever the server finds, the person is told the same thing: that a link
 * went out *if* the account exists. Saying "no such account" would let anybody
 * test whether an address belongs to a member (`password-reset-actions.ts`).
 */
export default function RequestResetForm(props: { expired?: boolean }) {
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [sentTo, setSentTo] = createSignal<string | null>(null)

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault()
    const email = String(
      new FormData(e.currentTarget as HTMLFormElement).get('email') ?? '',
    )
    if (!email) return setError(m.auth_login_errors_emailRequired())
    if (!isValidEmail(email)) return setError(m.auth_login_errors_emailInvalid())

    setSubmitting(true)
    setError(null)
    try {
      const result = await requestPasswordReset({ data: { email } })
      if (result.ok) setSentTo(email.trim())
      else setError(m.auth_reset_errors_rateLimited())
    } catch {
      setError(m.auth_login_errors_unexpected())
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Show
      when={sentTo()}
      fallback={
        <>
          <h1 class="font-serif text-3xl font-bold">{m.auth_reset_title()}</h1>
          <Show when={props.expired}>
            <p class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-danger">
              {m.auth_reset_expired()}
            </p>
          </Show>
          <p class="mt-3 text-[15px] text-ink-soft">{m.auth_reset_intro()}</p>
          <form
            class="mt-6 flex flex-col gap-4"
            onSubmit={(e) => void onSubmit(e)}
            novalidate
            aria-describedby="reset-status"
          >
            <label class="flex flex-col gap-1 text-sm">
              <span class="font-medium text-neutral-800">{m.auth_login_email()}</span>
              <input
                name="email"
                type="email"
                autocomplete="email"
                class={INPUT_CLASS}
                placeholder={m.auth_login_emailPlaceholder()}
                aria-invalid={error() ? 'true' : undefined}
              />
            </label>
            <button
              type="submit"
              disabled={submitting()}
              class="h-11 rounded-md bg-accent text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
            >
              {submitting() ? m.auth_reset_submitting() : m.auth_reset_submit()}
            </button>
            <p id="reset-status" aria-live="polite" class="min-h-5 text-sm text-danger">
              {error()}
            </p>
          </form>
        </>
      }
    >
      {(email) => (
        <div role="status">
          <h1 class="font-serif text-3xl font-bold">{m.auth_reset_sentTitle()}</h1>
          <p class="mt-3 text-[15px] leading-relaxed text-ink-soft">
            {m.auth_reset_sent({ email: email() })}
          </p>
        </div>
      )}
    </Show>
  )
}

/** Shared by both states of the reset page. */
export function BackToSignIn() {
  return (
    <p class="mt-6 border-t border-line pt-5 text-center text-[15px]">
      <Link to="/auth/login" class="font-semibold text-accent hover:underline">
        {m.auth_reset_backToLogin()}
      </Link>
    </p>
  )
}

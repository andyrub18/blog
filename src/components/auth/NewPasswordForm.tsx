import { Link } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import {
  type ResetPasswordErrorCode,
  resetPassword,
} from '../../lib/auth/password-reset-actions'
import { isValidPassword } from '../../lib/shared/validation'
import { m } from '../../paraglide/messages'
import { localizeHref } from '../../paraglide/runtime'

const INPUT_CLASS =
  'h-11 px-3 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20'

const BUTTON_CLASS =
  'mt-6 inline-flex h-11 items-center rounded-md bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-hover'

const ERROR_MESSAGE: Record<
  Exclude<ResetPasswordErrorCode, 'INVALID_TOKEN'>,
  () => string
> = {
  RATE_LIMITED: m.auth_login_errors_rateLimited,
  INVALID_PASSWORD: m.auth_login_errors_passwordTooShort,
  UNEXPECTED: m.auth_login_errors_unexpected,
}

/**
 * Choose a new password with the token from the emailed link.
 *
 * Asked twice, unlike at registration: the reset signs the account out
 * everywhere, so a typo here locks the person out again, on the one page they
 * reached because they were already locked out.
 */
export default function NewPasswordForm(props: { token: string }) {
  const [state, setState] = createSignal<'form' | 'done' | 'expired'>('form')
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget as HTMLFormElement)
    const password = String(fd.get('password') ?? '')
    if (!password) return setError(m.auth_login_errors_passwordRequired())
    if (!isValidPassword(password))
      return setError(m.auth_login_errors_passwordTooShort())
    if (password !== String(fd.get('confirm') ?? '')) {
      return setError(m.auth_reset_mismatch())
    }

    setSubmitting(true)
    setError(null)
    try {
      const result = await resetPassword({ data: { token: props.token, password } })
      if (result.ok) setState('done')
      else if (result.code === 'INVALID_TOKEN') setState('expired')
      else setError(ERROR_MESSAGE[result.code]())
    } catch {
      setError(m.auth_login_errors_unexpected())
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Show
      when={state() === 'form'}
      fallback={
        <div role="status">
          <Show
            when={state() === 'done'}
            fallback={
              <>
                <h1 class="font-serif text-3xl font-bold">{m.auth_reset_title()}</h1>
                <p class="mt-3 text-[15px] text-danger">{m.auth_reset_expired()}</p>
                {/* A page load, not the router: the route reads the token once,
                    in its loader, and the request form is this URL without it. */}
                <a href={localizeHref('/auth/reset-password')} class={BUTTON_CLASS}>
                  {m.auth_reset_requestAgain()}
                </a>
              </>
            }
          >
            <h1 class="font-serif text-3xl font-bold">{m.auth_reset_doneTitle()}</h1>
            <p class="mt-3 text-[15px] leading-relaxed text-ink-soft">
              {m.auth_reset_done()}
            </p>
            <Link to="/auth/login" class={BUTTON_CLASS}>
              {m.auth_login_submit()}
            </Link>
          </Show>
        </div>
      }
    >
      <h1 class="font-serif text-3xl font-bold">{m.auth_reset_newTitle()}</h1>
      <p class="mt-3 text-[15px] text-ink-soft">{m.auth_reset_newIntro()}</p>
      <form
        class="mt-6 flex flex-col gap-4"
        onSubmit={(e) => void onSubmit(e)}
        novalidate
        aria-describedby="new-password-status"
      >
        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium text-neutral-800">{m.auth_reset_newTitle()}</span>
          <input
            name="password"
            type="password"
            autocomplete="new-password"
            class={INPUT_CLASS}
            aria-invalid={error() ? 'true' : undefined}
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium text-neutral-800">{m.auth_reset_confirm()}</span>
          <input
            name="confirm"
            type="password"
            autocomplete="new-password"
            class={INPUT_CLASS}
            aria-invalid={error() ? 'true' : undefined}
          />
        </label>
        <button
          type="submit"
          disabled={submitting()}
          class="h-11 rounded-md bg-accent text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {submitting() ? m.auth_reset_saving() : m.auth_reset_save()}
        </button>
        <p
          id="new-password-status"
          aria-live="polite"
          class="min-h-5 text-sm text-danger"
        >
          {error()}
        </p>
      </form>
    </Show>
  )
}

import { useRouter } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { signInWithPassword } from '../../lib/auth-actions'
import { SIGN_IN_ERROR_MESSAGE } from '../../lib/auth-messages'
import { isValidEmail, isValidPassword } from '../../lib/validation'
import { m } from '../../paraglide/messages'
import ResendVerification from './ResendVerification'

type FieldErrors = Partial<Record<'email' | 'password', string>>

const INPUT_CLASS =
  'h-11 px-3 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20'

export default function LoginForm() {
  const router = useRouter()

  const [submitting, setSubmitting] = createSignal(false)
  const [serverError, setServerError] = createSignal<string | null>(null)
  const [errors, setErrors] = createSignal<FieldErrors>({})
  /**
   * The address of an account that exists but has never been verified.
   *
   * Someone whose verification email never arrived has no other way back in:
   * the address is taken, so registering again is refused, and the sign-in they
   * try instead is refused too. This is where they end up, so this is where the
   * mail has to be offered again.
   */
  const [unverified, setUnverified] = createSignal<string | null>(null)

  function validate(form: HTMLFormElement): FieldErrors {
    const fd = new FormData(form)
    const email = String(fd.get('email') ?? '')
    const password = String(fd.get('password') ?? '')
    const errs: FieldErrors = {}
    if (!email) errs.email = m.auth_login_errors_emailRequired()
    else if (!isValidEmail(email)) errs.email = m.auth_login_errors_emailInvalid()
    if (!password) errs.password = m.auth_login_errors_passwordRequired()
    else if (!isValidPassword(password)) {
      errs.password = m.auth_login_errors_passwordTooShort()
    }
    return errs
  }

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault()
    e.stopPropagation()
    const form = e.currentTarget as HTMLFormElement
    const errs = validate(form)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    const fd = new FormData(form)
    setSubmitting(true)
    setServerError(null)
    setUnverified(null)
    try {
      const result = await signInWithPassword({
        data: {
          email: String(fd.get('email') ?? ''),
          password: String(fd.get('password') ?? ''),
        },
      })
      if (!result.ok) {
        const message =
          SIGN_IN_ERROR_MESSAGE[result.code] ?? m.auth_login_errors_unexpected
        setServerError(message())
        if (result.code === 'EMAIL_NOT_VERIFIED') {
          setUnverified(String(fd.get('email') ?? ''))
        }
        return
      }
      await router.navigate({ to: '/' })
    } catch {
      setServerError(m.auth_login_errors_unexpected())
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      class="flex flex-col gap-4"
      onSubmit={(e) => void onSubmit(e)}
      novalidate
      aria-describedby="login-status"
    >
      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium text-neutral-800">{m.auth_login_email()}</span>
        <input
          id="email"
          name="email"
          type="email"
          autocomplete="email"
          class={INPUT_CLASS}
          placeholder={m.auth_login_emailPlaceholder()}
          aria-invalid={errors().email ? 'true' : undefined}
        />
        <Show when={errors().email}>
          {(message) => <span class="text-xs text-[#D21034]">{message()}</span>}
        </Show>
      </label>

      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium text-neutral-800">{m.auth_login_password()}</span>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          class={INPUT_CLASS}
          placeholder={m.auth_login_passwordPlaceholder()}
          aria-invalid={errors().password ? 'true' : undefined}
        />
        <Show when={errors().password}>
          {(message) => <span class="text-xs text-[#D21034]">{message()}</span>}
        </Show>
      </label>

      <button
        type="submit"
        disabled={submitting()}
        class="h-11 rounded-md bg-linear-to-r from-[#00209F] to-[#D21034] text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60"
      >
        {submitting() ? m.auth_login_submitting() : m.auth_login_submit()}
      </button>

      <div id="login-status" aria-live="polite" class="min-h-5 text-sm">
        <Show when={serverError()}>
          {(message) => <p class="text-[#D21034]">{message()}</p>}
        </Show>
        <Show when={unverified()}>
          {(email) => <ResendVerification email={email()} />}
        </Show>
      </div>
    </form>
  )
}

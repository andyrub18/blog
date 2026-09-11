import { useRouter } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { useLocale } from '../../i18n/context'
import { type SignInErrorCode, signInWithPassword } from '../../lib/auth-actions'
import { isValidEmail, isValidPassword } from '../../lib/validation'
import { m } from '../../paraglide/messages'

type MessageFn = () => string

const ERROR_MESSAGE: Record<SignInErrorCode, MessageFn> = {
  INVALID_EMAIL_OR_PASSWORD: m.auth_login_errors_invalidCredentials,
  INVALID_EMAIL: m.auth_login_errors_emailInvalid,
  INVALID_PASSWORD: m.auth_login_errors_passwordTooShort,
  EMAIL_NOT_VERIFIED: m.auth_login_errors_emailNotVerified,
  USER_NOT_FOUND: m.auth_login_errors_userNotFound,
  CREDENTIAL_ACCOUNT_NOT_FOUND: m.auth_login_errors_accountNotFound,
  FAILED_TO_CREATE_SESSION: m.auth_login_errors_sessionFailed,
  UNEXPECTED: m.auth_login_errors_unexpected,
}

type FieldErrors = Partial<Record<'email' | 'password', string>>

const INPUT_CLASS =
  'h-11 px-3 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20'

export default function LoginForm() {
  const router = useRouter()
  const locale = useLocale()

  const [submitting, setSubmitting] = createSignal(false)
  const [serverError, setServerError] = createSignal<string | null>(null)
  const [googleLoading, setGoogleLoading] = createSignal(false)
  const [info, setInfo] = createSignal<string | null>(null)
  const [errors, setErrors] = createSignal<FieldErrors>({})

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
    setInfo(null)
    try {
      const result = await signInWithPassword({
        data: {
          email: String(fd.get('email') ?? ''),
          password: String(fd.get('password') ?? ''),
        },
      })
      if (!result.ok) {
        const message = ERROR_MESSAGE[result.code] ?? m.auth_login_errors_unexpected
        setServerError(message())
        return
      }
      await router.navigate({ to: '/$lang', params: { lang: locale() } })
    } catch {
      setServerError(m.auth_login_errors_unexpected())
    } finally {
      setSubmitting(false)
    }
  }

  function onGoogleClick() {
    setServerError(null)
    setGoogleLoading(true)
    setTimeout(() => {
      setGoogleLoading(false)
      setInfo(m.auth_login_googleSoon())
    }, 400)
  }

  return (
    <form
      class="flex flex-col gap-4"
      onSubmit={(e) => void onSubmit(e)}
      novalidate
      aria-describedby="login-status"
    >
      <button
        type="button"
        onClick={onGoogleClick}
        disabled={googleLoading()}
        class="flex h-11 items-center justify-center gap-3 rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50 disabled:opacity-60"
      >
        <GoogleIcon />
        <span>
          {googleLoading() ? m.auth_login_submitting() : m.auth_login_googleContinue()}
        </span>
      </button>

      <div class="flex items-center gap-3 text-xs uppercase tracking-wider text-neutral-500">
        <div class="h-px flex-1 bg-neutral-200" />
        <span>{m.auth_login_separator()}</span>
        <div class="h-px flex-1 bg-neutral-200" />
      </div>

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
        <Show when={info()}>
          {(message) => <p class="text-neutral-600">{message()}</p>}
        </Show>
      </div>
    </form>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" class="shrink-0">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1-3.31 0-6-2.74-6-6.2s2.69-6.2 6-6.2c1.88 0 3.14.8 3.86 1.49l2.63-2.54C16.83 3.13 14.62 2.2 12 2.2 6.95 2.2 2.86 6.29 2.86 12s4.09 9.8 9.14 9.8c5.27 0 8.76-3.7 8.76-8.92 0-.6-.07-1.06-.16-1.52H12z"
      />
    </svg>
  )
}

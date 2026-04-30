import { createSignal, Show } from 'solid-js'
import { createForm } from '@tanstack/solid-form'
import { useRouter } from '@tanstack/solid-router'
import { signInWithPassword, type SignInErrorCode } from '../../lib/auth-actions'
import { useI18n } from '../../i18n/context'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type LoginValues = {
  email: string
  password: string
}

const ERROR_KEY_BY_CODE: Record<SignInErrorCode, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'auth.login.errors.invalidCredentials',
  INVALID_EMAIL: 'auth.login.errors.emailInvalid',
  INVALID_PASSWORD: 'auth.login.errors.passwordTooShort',
  EMAIL_NOT_VERIFIED: 'auth.login.errors.emailNotVerified',
  USER_NOT_FOUND: 'auth.login.errors.userNotFound',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'auth.login.errors.accountNotFound',
  FAILED_TO_CREATE_SESSION: 'auth.login.errors.sessionFailed',
  UNEXPECTED: 'auth.login.errors.unexpected',
}

export default function LoginForm() {
  const router = useRouter()
  const { t, locale } = useI18n()

  const [serverError, setServerError] = createSignal<string | null>(null)
  const [googleLoading, setGoogleLoading] = createSignal(false)
  const [info, setInfo] = createSignal<string | null>(null)

  const form = createForm(() => ({
    defaultValues: { email: '', password: '' } as LoginValues,
    onSubmit: async ({ value }) => {
      setServerError(null)
      setInfo(null)
      try {
        const result = await signInWithPassword({
          data: { email: value.email, password: value.password },
        })
        if (!result.ok) {
          const key = ERROR_KEY_BY_CODE[result.code] ?? 'auth.login.errors.unexpected'
          setServerError(t(key as 'auth.login.errors.unexpected') ?? null)
          return
        }
        await router.navigate({ to: '/$lang', params: { lang: locale() } })
      } catch (err) {
        setServerError(t('auth.login.errors.unexpected') ?? null)
      }
    },
  }))

  function onGoogleClick() {
    setServerError(null)
    setGoogleLoading(true)
    setTimeout(() => {
      setGoogleLoading(false)
      setInfo(t('auth.login.googleSoon') ?? null)
    }, 400)
  }

  return (
    <form
      class="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void form.handleSubmit()
      }}
      novalidate
      aria-describedby="login-status"
    >
      <button
        type="button"
        onClick={onGoogleClick}
        disabled={googleLoading()}
        class="flex items-center justify-center gap-3 h-11 px-4 rounded-md border border-neutral-300 bg-white text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60 transition-colors"
      >
        <GoogleIcon />
        <span>
          {googleLoading() ? t('auth.login.submitting') : t('auth.login.googleContinue')}
        </span>
      </button>

      <div class="flex items-center gap-3 text-xs uppercase tracking-wider text-neutral-500">
        <div class="h-px flex-1 bg-neutral-200" />
        <span>{t('auth.login.separator')}</span>
        <div class="h-px flex-1 bg-neutral-200" />
      </div>

      <form.Field
        name="email"
        validators={{
          onChange: ({ value }) =>
            !value
              ? t('auth.login.errors.emailRequired')
              : !EMAIL_RE.test(value)
                ? t('auth.login.errors.emailInvalid')
                : undefined,
        }}
      >
        {(field) => (
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-neutral-800">{t('auth.login.email')}</span>
            <input
              id={field().name}
              name={field().name}
              type="email"
              autocomplete="email"
              value={field().state.value}
              onBlur={field().handleBlur}
              onInput={(e) => field().handleChange(e.currentTarget.value)}
              class="h-11 px-3 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
              placeholder={t('auth.login.emailPlaceholder')}
            />
            <FieldError field={field()} />
          </label>
        )}
      </form.Field>

      <form.Field
        name="password"
        validators={{
          onChange: ({ value }) =>
            !value
              ? t('auth.login.errors.passwordRequired')
              : value.length < 8
                ? t('auth.login.errors.passwordTooShort')
                : undefined,
        }}
      >
        {(field) => (
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-neutral-800">{t('auth.login.password')}</span>
            <input
              id={field().name}
              name={field().name}
              type="password"
              autocomplete="current-password"
              value={field().state.value}
              onBlur={field().handleBlur}
              onInput={(e) => field().handleChange(e.currentTarget.value)}
              class="h-11 px-3 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
              placeholder={t('auth.login.passwordPlaceholder')}
            />
            <FieldError field={field()} />
          </label>
        )}
      </form.Field>

      <form.Subscribe
        selector={(state) => ({
          canSubmit: state.canSubmit,
          isSubmitting: state.isSubmitting,
        })}
      >
        {(state) => (
          <button
            type="submit"
            disabled={!state().canSubmit}
            class="h-11 rounded-md bg-linear-to-r from-[#00209F] to-[#D21034] text-white text-sm font-semibold shadow-sm hover:opacity-95 disabled:opacity-60 transition-opacity"
          >
            {state().isSubmitting ? t('auth.login.submitting') : t('auth.login.submit')}
          </button>
        )}
      </form.Subscribe>

      <div id="login-status" aria-live="polite" class="min-h-5 text-sm">
        <Show when={serverError()}>
          <p class="text-[#D21034]">{serverError()}</p>
        </Show>
        <Show when={info()}>
          <p class="text-neutral-600">{info()}</p>
        </Show>
      </div>
    </form>
  )
}

function FieldError(props: {
  field: { state: { meta: { isTouched: boolean; errors: Array<unknown> } } }
}) {
  return (
    <Show
      when={
        props.field.state.meta.isTouched && props.field.state.meta.errors.length
      }
    >
      <span class="text-xs text-[#D21034]">
        {String(props.field.state.meta.errors[0])}
      </span>
    </Show>
  )
}

function GoogleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      class="shrink-0"
    >
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1-3.31 0-6-2.74-6-6.2s2.69-6.2 6-6.2c1.88 0 3.14.8 3.86 1.49l2.63-2.54C16.83 3.13 14.62 2.2 12 2.2 6.95 2.2 2.86 6.29 2.86 12s4.09 9.8 9.14 9.8c5.27 0 8.76-3.7 8.76-8.92 0-.6-.07-1.06-.16-1.52H12z"
      />
    </svg>
  )
}

import { createSignal, Show } from 'solid-js'
import { createForm } from '@tanstack/solid-form'
import { useRouter } from '@tanstack/solid-router'
import { signUpReader, type SignUpErrorCode } from '../../lib/auth-actions'
import { useI18n } from '../../i18n/context'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ERROR_KEY: Record<SignUpErrorCode, string> = {
  INVALID_EMAIL: 'auth.login.errors.emailInvalid',
  INVALID_PASSWORD: 'auth.login.errors.passwordTooShort',
  INVALID_NAME: 'auth.register.errors.nameInvalid',
  INVALID_DATE_OF_BIRTH: 'auth.register.errors.dobInvalid',
  TOO_YOUNG: 'auth.register.errors.tooYoung',
  INVALID_ESSAY: 'auth.register.errors.essayTooShort',
  INVALID_PDF: 'auth.register.errors.invalidPdf',
  PDF_TOO_LARGE: 'auth.register.errors.pdfTooLarge',
  EMAIL_ALREADY_EXISTS: 'auth.register.errors.emailExists',
  UNEXPECTED: 'auth.register.errors.unexpected',
}

type Values = {
  name: string
  email: string
  password: string
  dateOfBirth: string
  essay: string
}

export default function RegisterReaderForm() {
  const router = useRouter()
  const { tx: t, locale } = useI18n()
  const [serverError, setServerError] = createSignal<string | null>(null)
  const [success, setSuccess] = createSignal(false)

  const form = createForm(() => ({
    defaultValues: {
      name: '',
      email: '',
      password: '',
      dateOfBirth: '',
      essay: '',
    } as Values,
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        const result = await signUpReader({ data: value })
        if (!result.ok) {
          setServerError(t(ERROR_KEY[result.code] as 'auth.register.errors.unexpected'))
          return
        }
        setSuccess(true)
        router.invalidate()
      } catch {
        setServerError(t('auth.register.errors.unexpected'))
      }
    },
  }))

  return (
    <Show
      when={!success()}
      fallback={
        <SuccessPanel
          title={t('auth.register.success.title')}
          hint={t('auth.register.success.verifyHint')}
          loginCta={t('auth.verify.goLogin')}
          onLogin={() =>
            router.navigate({ to: '/$lang/auth/login', params: { lang: locale() } })
          }
        />
      }
    >
      <form
        class="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
        novalidate
      >
        <form.Field
          name="name"
          validators={{
            onChange: ({ value }) =>
              !value || value.trim().length < 2
                ? t('auth.register.errors.nameInvalid')
                : undefined,
          }}
        >
          {(field) => (
            <TextInput
              field={field()}
              type="text"
              autocomplete="name"
              label={t('auth.register.common.name')}
              placeholder={t('auth.register.common.namePlaceholder')}
            />
          )}
        </form.Field>

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
            <TextInput
              field={field()}
              type="email"
              autocomplete="email"
              label={t('auth.login.email')}
              placeholder={t('auth.login.emailPlaceholder')}
            />
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
            <TextInput
              field={field()}
              type="password"
              autocomplete="new-password"
              label={t('auth.login.password')}
              placeholder={t('auth.login.passwordPlaceholder')}
            />
          )}
        </form.Field>

        <form.Field
          name="dateOfBirth"
          validators={{
            onChange: ({ value }) =>
              !value ? t('auth.register.errors.dobRequired') : undefined,
          }}
        >
          {(field) => (
            <TextInput
              field={field()}
              type="date"
              label={t('auth.register.common.dateOfBirth')}
            />
          )}
        </form.Field>

        <form.Field
          name="essay"
          validators={{
            onChange: ({ value }) =>
              !value || value.trim().length < 50
                ? t('auth.register.errors.essayTooShort')
                : undefined,
          }}
        >
          {(field) => (
            <label class="flex flex-col gap-1 text-sm">
              <span class="font-medium text-neutral-800">
                {t('auth.register.common.essay')}
              </span>
              <textarea
                id={field().name}
                name={field().name}
                rows={5}
                value={field().state.value}
                onBlur={field().handleBlur}
                onInput={(e) => field().handleChange(e.currentTarget.value)}
                class="px-3 py-2 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
                placeholder={t('auth.register.common.essayPlaceholder')}
              />
              <FieldError field={field()} />
            </label>
          )}
        </form.Field>

        <form.Subscribe
          selector={(s) => ({ canSubmit: s.canSubmit, isSubmitting: s.isSubmitting })}
        >
          {(state) => (
            <button
              type="submit"
              disabled={!state().canSubmit}
              class="h-11 rounded-md bg-linear-to-r from-[#00209F] to-[#D21034] text-white text-sm font-semibold shadow-sm hover:opacity-95 disabled:opacity-60 transition-opacity"
            >
              {state().isSubmitting
                ? t('auth.register.common.submitting')
                : t('auth.register.common.submit')}
            </button>
          )}
        </form.Subscribe>

        <div aria-live="polite" class="min-h-5 text-sm">
          <Show when={serverError()}>
            <p class="text-[#D21034]">{serverError()}</p>
          </Show>
        </div>
      </form>
    </Show>
  )
}

function TextInput(props: {
  field: {
    name: string
    state: { value: string; meta: { isTouched: boolean; errors: Array<unknown> } }
    handleBlur: () => void
    handleChange: (value: string) => void
  }
  type: string
  label: string
  placeholder?: string
  autocomplete?: string
}) {
  return (
    <label class="flex flex-col gap-1 text-sm">
      <span class="font-medium text-neutral-800">{props.label}</span>
      <input
        id={props.field.name}
        name={props.field.name}
        type={props.type}
        autocomplete={props.autocomplete}
        value={props.field.state.value}
        onBlur={props.field.handleBlur}
        onInput={(e) => props.field.handleChange(e.currentTarget.value)}
        class="h-11 px-3 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
        placeholder={props.placeholder}
      />
      <FieldError field={props.field} />
    </label>
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

function SuccessPanel(props: {
  title: string
  hint: string
  loginCta: string
  onLogin: () => void
}) {
  return (
    <div class="flex flex-col items-center gap-4 text-center">
      <h2 class="text-lg font-semibold text-neutral-900">{props.title}</h2>
      <p class="text-sm text-neutral-700">{props.hint}</p>
      <button
        type="button"
        onClick={props.onLogin}
        class="h-11 px-4 rounded-md bg-[#00209F] text-white text-sm font-semibold hover:opacity-95"
      >
        {props.loginCta}
      </button>
    </div>
  )
}

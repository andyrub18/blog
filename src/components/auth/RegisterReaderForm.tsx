import { useRouteContext, useRouter } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { type SignUpErrorCode, signUpReader } from '../../lib/auth-actions'
import {
  isValidEmail,
  isValidEssay,
  isValidName,
  isValidPassword,
} from '../../lib/validation'
import { m } from '../../paraglide/messages'
import Turnstile from './Turnstile'

type MessageFn = () => string

const ERROR_MESSAGE: Record<SignUpErrorCode, MessageFn> = {
  RATE_LIMITED: m.auth_register_errors_rateLimited,
  CAPTCHA_FAILED: m.auth_register_errors_captchaFailed,
  INVALID_EMAIL: m.auth_login_errors_emailInvalid,
  INVALID_PASSWORD: m.auth_login_errors_passwordTooShort,
  INVALID_NAME: m.auth_register_errors_nameInvalid,
  INVALID_DATE_OF_BIRTH: m.auth_register_errors_dobInvalid,
  TOO_YOUNG: m.auth_register_errors_tooYoung,
  INVALID_ESSAY: m.auth_register_errors_essayTooShort,
  INVALID_PDF: m.auth_register_errors_invalidPdf,
  PDF_TOO_LARGE: m.auth_register_errors_pdfTooLarge,
  EMAIL_ALREADY_EXISTS: m.auth_register_errors_emailExists,
  UNEXPECTED: m.auth_register_errors_unexpected,
}

type Field = 'name' | 'email' | 'password' | 'dateOfBirth' | 'essay'
type FieldErrors = Partial<Record<Field, string>>

const INPUT_CLASS =
  'h-11 px-3 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20'

export default function RegisterReaderForm() {
  const router = useRouter()
  const context = useRouteContext({ from: '/_app' })
  const [submitting, setSubmitting] = createSignal(false)
  const [serverError, setServerError] = createSignal<string | null>(null)
  const [errors, setErrors] = createSignal<FieldErrors>({})
  const [success, setSuccess] = createSignal(false)

  function validate(fd: FormData): FieldErrors {
    const errs: FieldErrors = {}
    const name = String(fd.get('name') ?? '')
    const email = String(fd.get('email') ?? '')
    const password = String(fd.get('password') ?? '')
    const dateOfBirth = String(fd.get('dateOfBirth') ?? '')
    const essay = String(fd.get('essay') ?? '')
    if (!isValidName(name)) errs.name = m.auth_register_errors_nameInvalid()
    if (!isValidEmail(email)) errs.email = m.auth_login_errors_emailInvalid()
    if (!isValidPassword(password)) {
      errs.password = m.auth_login_errors_passwordTooShort()
    }
    if (!dateOfBirth) errs.dateOfBirth = m.auth_register_errors_dobRequired()
    if (!isValidEssay(essay)) errs.essay = m.auth_register_errors_essayTooShort()
    return errs
  }

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault()
    e.stopPropagation()
    const fd = new FormData(e.currentTarget as HTMLFormElement)
    const errs = validate(fd)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setSubmitting(true)
    setServerError(null)
    try {
      const result = await signUpReader({
        data: {
          name: String(fd.get('name') ?? ''),
          email: String(fd.get('email') ?? ''),
          password: String(fd.get('password') ?? ''),
          dateOfBirth: String(fd.get('dateOfBirth') ?? ''),
          essay: String(fd.get('essay') ?? ''),
          captchaToken: String(fd.get('captchaToken') ?? '') || undefined,
        },
      })
      if (!result.ok) {
        setServerError(ERROR_MESSAGE[result.code]())
        return
      }
      setSuccess(true)
      router.invalidate()
    } catch {
      setServerError(m.auth_register_errors_unexpected())
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Show
      when={!success()}
      fallback={
        <SuccessPanel
          title={m.auth_register_success_title()}
          hint={m.auth_register_success_verifyHint()}
          loginCta={m.auth_verify_goLogin()}
          onLogin={() => router.navigate({ to: '/auth/login' })}
        />
      }
    >
      <form
        class="flex flex-col gap-4"
        onSubmit={(e) => void onSubmit(e)}
        novalidate
        aria-describedby="register-status"
      >
        <TextInput
          name="name"
          type="text"
          autocomplete="name"
          label={m.auth_register_common_name()}
          placeholder={m.auth_register_common_namePlaceholder()}
          error={errors().name}
        />
        <TextInput
          name="email"
          type="email"
          autocomplete="email"
          label={m.auth_login_email()}
          placeholder={m.auth_login_emailPlaceholder()}
          error={errors().email}
        />
        <TextInput
          name="password"
          type="password"
          autocomplete="new-password"
          label={m.auth_login_password()}
          placeholder={m.auth_login_passwordPlaceholder()}
          error={errors().password}
        />
        <TextInput
          name="dateOfBirth"
          type="date"
          label={m.auth_register_common_dateOfBirth()}
          error={errors().dateOfBirth}
        />

        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium text-neutral-800">
            {m.auth_register_common_essay()}
          </span>
          <textarea
            id="essay"
            name="essay"
            rows="5"
            class="rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
            placeholder={m.auth_register_common_essayPlaceholder()}
            aria-invalid={errors().essay ? 'true' : undefined}
          />
          <Show when={errors().essay}>
            {(message) => <span class="text-xs text-[#D21034]">{message()}</span>}
          </Show>
        </label>

        <Turnstile siteKey={context().config.turnstileSiteKey} />

        <button
          type="submit"
          disabled={submitting()}
          class="h-11 rounded-md bg-linear-to-r from-[#00209F] to-[#D21034] text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60"
        >
          {submitting()
            ? m.auth_register_common_submitting()
            : m.auth_register_common_submit()}
        </button>

        <div id="register-status" aria-live="polite" class="min-h-5 text-sm">
          <Show when={serverError()}>
            {(message) => <p class="text-[#D21034]">{message()}</p>}
          </Show>
        </div>
      </form>
    </Show>
  )
}

function TextInput(props: {
  name: string
  type: string
  label: string
  placeholder?: string
  autocomplete?: string
  error?: string
}) {
  return (
    <label class="flex flex-col gap-1 text-sm">
      <span class="font-medium text-neutral-800">{props.label}</span>
      <input
        id={props.name}
        name={props.name}
        type={props.type}
        autocomplete={props.autocomplete}
        class={INPUT_CLASS}
        placeholder={props.placeholder}
        aria-invalid={props.error ? 'true' : undefined}
      />
      <Show when={props.error}>
        {(message) => <span class="text-xs text-[#D21034]">{message()}</span>}
      </Show>
    </label>
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
        class="h-11 rounded-md bg-[#00209F] px-4 text-sm font-semibold text-white hover:opacity-95"
      >
        {props.loginCta}
      </button>
    </div>
  )
}

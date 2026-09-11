import type { JSX } from '@solidjs/web'
import { useRouter } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { type SignUpErrorCode, signUpMember } from '../../lib/auth-actions'
import { m } from '../../paraglide/messages'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type MessageFn = () => string

const ERROR_MESSAGE: Record<SignUpErrorCode, MessageFn> = {
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

type FieldErrors = Partial<
  Record<
    | 'name'
    | 'email'
    | 'password'
    | 'dateOfBirth'
    | 'essay'
    | 'cv'
    | 'vision'
    | 'contribution',
    string
  >
>

export default function RegisterMemberForm() {
  const router = useRouter()
  const [submitting, setSubmitting] = createSignal(false)
  const [serverError, setServerError] = createSignal<string | null>(null)
  const [errors, setErrors] = createSignal<FieldErrors>({})
  const [success, setSuccess] = createSignal(false)

  function validate(form: HTMLFormElement): FieldErrors {
    const fd = new FormData(form)
    const errs: FieldErrors = {}
    const name = String(fd.get('name') ?? '').trim()
    const email = String(fd.get('email') ?? '').trim()
    const password = String(fd.get('password') ?? '')
    const essay = String(fd.get('essay') ?? '').trim()
    const dob = String(fd.get('dateOfBirth') ?? '')
    if (name.length < 2) errs.name = m.auth_register_errors_nameInvalid()
    if (!EMAIL_RE.test(email)) errs.email = m.auth_login_errors_emailInvalid()
    if (password.length < 8) errs.password = m.auth_login_errors_passwordTooShort()
    if (!dob) errs.dateOfBirth = m.auth_register_errors_dobRequired()
    if (essay.length < 50) errs.essay = m.auth_register_errors_essayTooShort()
    for (const f of ['cv', 'vision', 'contribution'] as const) {
      const file = fd.get(f)
      if (!(file instanceof File) || file.size === 0) {
        errs[f] = m.auth_register_errors_invalidPdf()
      } else if (file.type !== 'application/pdf') {
        errs[f] = m.auth_register_errors_invalidPdf()
      } else if (file.size > 5 * 1024 * 1024) {
        errs[f] = m.auth_register_errors_pdfTooLarge()
      }
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
    setSubmitting(true)
    setServerError(null)
    try {
      const fd = new FormData(form)
      const result = await signUpMember({ data: fd })
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
        <div class="flex flex-col items-center gap-4 text-center">
          <h2 class="text-lg font-semibold text-neutral-900">
            {m.auth_register_success_title()}
          </h2>
          <p class="text-sm text-neutral-700">{m.auth_register_success_verifyHint()}</p>
          <p class="text-sm text-neutral-700">{m.auth_register_success_memberHint()}</p>
          <button
            type="button"
            onClick={() => router.navigate({ to: '/auth/login' })}
            class="h-11 px-4 rounded-md bg-[#00209F] text-white text-sm font-semibold hover:opacity-95"
          >
            {m.auth_verify_goLogin()}
          </button>
        </div>
      }
    >
      <form
        class="flex flex-col gap-4"
        onSubmit={onSubmit}
        novalidate
        enctype="multipart/form-data"
      >
        <p class="text-sm text-neutral-600">{m.auth_register_member_statusNote()}</p>

        <Field label={m.auth_register_common_name()} error={errors().name}>
          <input
            name="name"
            type="text"
            autocomplete="name"
            class={inputClass}
            placeholder={m.auth_register_common_namePlaceholder()}
          />
        </Field>

        <Field label={m.auth_login_email()} error={errors().email}>
          <input
            name="email"
            type="email"
            autocomplete="email"
            class={inputClass}
            placeholder={m.auth_login_emailPlaceholder()}
          />
        </Field>

        <Field label={m.auth_login_password()} error={errors().password}>
          <input
            name="password"
            type="password"
            autocomplete="new-password"
            class={inputClass}
            placeholder={m.auth_login_passwordPlaceholder()}
          />
        </Field>

        <Field label={m.auth_register_common_dateOfBirth()} error={errors().dateOfBirth}>
          <input name="dateOfBirth" type="date" class={inputClass} />
        </Field>

        <Field label={m.auth_register_common_essay()} error={errors().essay}>
          <textarea
            name="essay"
            rows={4}
            class="px-3 py-2 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
            placeholder={m.auth_register_common_essayPlaceholder()}
          />
        </Field>

        <p class="text-xs text-neutral-500">{m.auth_register_member_pdfHint()}</p>

        <Field label={m.auth_register_member_cv()} error={errors().cv}>
          <input name="cv" type="file" accept="application/pdf" class={fileClass} />
        </Field>
        <Field label={m.auth_register_member_vision()} error={errors().vision}>
          <input name="vision" type="file" accept="application/pdf" class={fileClass} />
        </Field>
        <Field
          label={m.auth_register_member_contribution()}
          error={errors().contribution}
        >
          <input
            name="contribution"
            type="file"
            accept="application/pdf"
            class={fileClass}
          />
        </Field>

        <button
          type="submit"
          disabled={submitting()}
          class="h-11 rounded-md bg-linear-to-r from-[#00209F] to-[#D21034] text-white text-sm font-semibold shadow-sm hover:opacity-95 disabled:opacity-60 transition-opacity"
        >
          {submitting()
            ? m.auth_register_common_submitting()
            : m.auth_register_common_submit()}
        </button>

        <div aria-live="polite" class="min-h-5 text-sm">
          <Show when={serverError()}>
            <p class="text-[#D21034]">{serverError()}</p>
          </Show>
        </div>
      </form>
    </Show>
  )
}

const inputClass =
  'h-11 px-3 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20'

const fileClass =
  'block w-full text-sm text-neutral-700 file:mr-4 file:h-10 file:px-4 file:rounded-md file:border-0 file:bg-[#00209F] file:text-white file:font-medium hover:file:opacity-95'

function Field(props: { label: string; error?: string; children: JSX.Element }) {
  return (
    // Not a <label>: this wraps controls that already carry their own label
    // association via id/for, and nesting them would bind the group to the
    // first control only.
    <div class="flex flex-col gap-1 text-sm">
      <span class="font-medium text-neutral-800">{props.label}</span>
      {props.children}
      <Show when={props.error}>
        <span class="text-xs text-[#D21034]">{props.error}</span>
      </Show>
    </div>
  )
}

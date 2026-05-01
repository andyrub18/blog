import { createSignal, Show } from 'solid-js'
import { useRouter } from '@tanstack/solid-router'
import { signUpMember, type SignUpErrorCode } from '../../lib/auth-actions'
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

type FieldErrors = Partial<
  Record<
    'name' | 'email' | 'password' | 'dateOfBirth' | 'essay' | 'cv' | 'vision' | 'contribution',
    string
  >
>

export default function RegisterMemberForm() {
  const router = useRouter()
  const { tx: t, locale } = useI18n()
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
    if (name.length < 2) errs.name = t('auth.register.errors.nameInvalid')
    if (!EMAIL_RE.test(email)) errs.email = t('auth.login.errors.emailInvalid')
    if (password.length < 8) errs.password = t('auth.login.errors.passwordTooShort')
    if (!dob) errs.dateOfBirth = t('auth.register.errors.dobRequired')
    if (essay.length < 50) errs.essay = t('auth.register.errors.essayTooShort')
    for (const f of ['cv', 'vision', 'contribution'] as const) {
      const file = fd.get(f)
      if (!(file instanceof File) || file.size === 0) {
        errs[f] = t('auth.register.errors.invalidPdf')
      } else if (file.type !== 'application/pdf') {
        errs[f] = t('auth.register.errors.invalidPdf')
      } else if (file.size > 5 * 1024 * 1024) {
        errs[f] = t('auth.register.errors.pdfTooLarge')
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
        setServerError(t(ERROR_KEY[result.code] as 'auth.register.errors.unexpected'))
        return
      }
      setSuccess(true)
      router.invalidate()
    } catch {
      setServerError(t('auth.register.errors.unexpected'))
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
            {t('auth.register.success.title')}
          </h2>
          <p class="text-sm text-neutral-700">
            {t('auth.register.success.verifyHint')}
          </p>
          <p class="text-sm text-neutral-700">
            {t('auth.register.success.memberHint')}
          </p>
          <button
            type="button"
            onClick={() =>
              router.navigate({ to: '/$lang/auth/login', params: { lang: locale() } })
            }
            class="h-11 px-4 rounded-md bg-[#00209F] text-white text-sm font-semibold hover:opacity-95"
          >
            {t('auth.verify.goLogin')}
          </button>
        </div>
      }
    >
      <form class="flex flex-col gap-4" onSubmit={onSubmit} novalidate enctype="multipart/form-data">
        <p class="text-sm text-neutral-600">{t('auth.register.member.statusNote')}</p>

        <Field label={t('auth.register.common.name')} error={errors().name}>
          <input
            name="name"
            type="text"
            autocomplete="name"
            class={inputClass}
            placeholder={t('auth.register.common.namePlaceholder')}
          />
        </Field>

        <Field label={t('auth.login.email')} error={errors().email}>
          <input
            name="email"
            type="email"
            autocomplete="email"
            class={inputClass}
            placeholder={t('auth.login.emailPlaceholder')}
          />
        </Field>

        <Field label={t('auth.login.password')} error={errors().password}>
          <input
            name="password"
            type="password"
            autocomplete="new-password"
            class={inputClass}
            placeholder={t('auth.login.passwordPlaceholder')}
          />
        </Field>

        <Field label={t('auth.register.common.dateOfBirth')} error={errors().dateOfBirth}>
          <input name="dateOfBirth" type="date" class={inputClass} />
        </Field>

        <Field label={t('auth.register.common.essay')} error={errors().essay}>
          <textarea
            name="essay"
            rows={4}
            class="px-3 py-2 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
            placeholder={t('auth.register.common.essayPlaceholder')}
          />
        </Field>

        <p class="text-xs text-neutral-500">{t('auth.register.member.pdfHint')}</p>

        <Field label={t('auth.register.member.cv')} error={errors().cv}>
          <input name="cv" type="file" accept="application/pdf" class={fileClass} />
        </Field>
        <Field label={t('auth.register.member.vision')} error={errors().vision}>
          <input name="vision" type="file" accept="application/pdf" class={fileClass} />
        </Field>
        <Field
          label={t('auth.register.member.contribution')}
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
            ? t('auth.register.common.submitting')
            : t('auth.register.common.submit')}
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

function Field(props: { label: string; error?: string; children: any }) {
  return (
    <label class="flex flex-col gap-1 text-sm">
      <span class="font-medium text-neutral-800">{props.label}</span>
      {props.children}
      <Show when={props.error}>
        <span class="text-xs text-[#D21034]">{props.error}</span>
      </Show>
    </label>
  )
}

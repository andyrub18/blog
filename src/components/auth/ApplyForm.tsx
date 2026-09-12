import { useRouter } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { type ApplyErrorCode, applyForMembership } from '../../lib/auth-actions'
import { MAX_PDF_BYTES, MIN_CONTRIBUTION_PLAN_CHARS } from '../../lib/validation'
import { m } from '../../paraglide/messages'

type MessageFn = () => string

const ERROR_MESSAGE: Record<ApplyErrorCode, MessageFn> = {
  NOT_SIGNED_IN: m.apply_errors_notSignedIn,
  ALREADY_MEMBER: m.apply_errors_alreadyMember,
  APPLICATION_OPEN: m.apply_errors_applicationOpen,
  EMAIL_UNVERIFIED: m.apply_errors_emailUnverified,
  INVALID_PLAN: m.apply_errors_invalidPlan,
  INVALID_PDF: m.auth_register_errors_invalidPdf,
  PDF_TOO_LARGE: m.auth_register_errors_pdfTooLarge,
  RATE_LIMITED: m.apply_errors_rateLimited,
  UNEXPECTED: m.apply_errors_unexpected,
}

type Field = 'contributionPlan' | 'cv' | 'vision' | 'contribution'
type FieldErrors = Partial<Record<Field, string>>

const FILE_CLASS =
  'block w-full text-sm text-neutral-700 file:mr-4 file:h-10 file:rounded-md file:border-0 file:bg-[#00209F] file:px-4 file:font-medium file:text-white hover:file:opacity-95'

export default function ApplyForm() {
  const router = useRouter()
  const [submitting, setSubmitting] = createSignal(false)
  const [serverError, setServerError] = createSignal<string | null>(null)
  const [errors, setErrors] = createSignal<FieldErrors>({})
  const [success, setSuccess] = createSignal(false)

  function validate(fd: FormData): FieldErrors {
    const errs: FieldErrors = {}
    if (
      String(fd.get('contributionPlan') ?? '').trim().length < MIN_CONTRIBUTION_PLAN_CHARS
    ) {
      errs.contributionPlan = m.apply_errors_invalidPlan()
    }
    for (const field of ['cv', 'vision', 'contribution'] as const) {
      const file = fd.get(field)
      if (!(file instanceof File) || file.size === 0) {
        errs[field] = m.auth_register_errors_invalidPdf()
      } else if (file.size > MAX_PDF_BYTES) {
        errs[field] = m.auth_register_errors_pdfTooLarge()
      }
    }
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
      const result = await applyForMembership({ data: fd })
      if (!result.ok) {
        setServerError(ERROR_MESSAGE[result.code]())
        return
      }
      setSuccess(true)
      router.invalidate()
    } catch {
      setServerError(m.apply_errors_unexpected())
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Show
      when={!success()}
      fallback={
        <div class="flex flex-col items-center gap-3 text-center">
          <h2 class="text-lg font-semibold text-neutral-900">{m.apply_successTitle()}</h2>
          <p class="text-sm text-neutral-700">{m.apply_successHint()}</p>
        </div>
      }
    >
      <form
        class="flex flex-col gap-4"
        onSubmit={(e) => void onSubmit(e)}
        novalidate
        aria-describedby="apply-status"
      >
        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium text-neutral-800">{m.apply_planLabel()}</span>
          <span class="text-xs text-neutral-500">{m.apply_planHint()}</span>
          <textarea
            id="contributionPlan"
            name="contributionPlan"
            rows="6"
            class="rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
            aria-invalid={errors().contributionPlan ? 'true' : undefined}
          />
          <Show when={errors().contributionPlan}>
            {(message) => <span class="text-xs text-[#D21034]">{message()}</span>}
          </Show>
        </label>

        <FileField name="cv" label={m.auth_register_member_cv()} error={errors().cv} />
        <FileField
          name="vision"
          label={m.auth_register_member_vision()}
          error={errors().vision}
        />
        <FileField
          name="contribution"
          label={m.auth_register_member_contribution()}
          error={errors().contribution}
        />

        <button
          type="submit"
          disabled={submitting()}
          class="h-11 rounded-md bg-linear-to-r from-[#00209F] to-[#D21034] text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60"
        >
          {submitting() ? m.apply_submitting() : m.apply_submit()}
        </button>

        <div id="apply-status" aria-live="polite" class="min-h-5 text-sm">
          <Show when={serverError()}>
            {(message) => <p class="text-[#D21034]">{message()}</p>}
          </Show>
        </div>
      </form>
    </Show>
  )
}

function FileField(props: { name: string; label: string; error?: string }) {
  return (
    <div class="flex flex-col gap-1 text-sm">
      <label for={props.name} class="font-medium text-neutral-800">
        {props.label}
      </label>
      <input
        id={props.name}
        name={props.name}
        type="file"
        accept="application/pdf"
        class={FILE_CLASS}
        aria-invalid={props.error ? 'true' : undefined}
      />
      <Show when={props.error}>
        {(message) => <span class="text-xs text-[#D21034]">{message()}</span>}
      </Show>
    </div>
  )
}

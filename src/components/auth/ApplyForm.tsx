import { useRouter } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { type ApplyErrorCode, applyForMembership } from '../../lib/auth/auth-actions'
import { MAX_PDF_BYTES, MIN_CONTRIBUTION_PLAN_CHARS } from '../../lib/shared/validation'
import { m } from '../../paraglide/messages'
import FilePicker from '../FilePicker'
import ApplicationFiled from './ApplicationFiled'

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
      // Refreshes the layout and this route: the home page stops offering
      // "Devenir membre", and `/apply` re-reads its loader and settles on the
      // same confirmation panel this component is already showing. Painting it
      // here first means the applicant is not left looking at the form they
      // just sent for the length of that round trip.
      router.invalidate()
    } catch {
      setServerError(m.apply_errors_unexpected())
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Show when={!success()} fallback={<ApplicationFiled />}>
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
            class="rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            aria-invalid={errors().contributionPlan ? 'true' : undefined}
          />
          <Show when={errors().contributionPlan}>
            {(message) => <span class="text-xs text-danger">{message()}</span>}
          </Show>
        </label>

        <FilePicker
          name="cv"
          accept="application/pdf"
          label={m.auth_register_member_cv()}
          error={errors().cv}
        />
        <FilePicker
          accept="application/pdf"
          name="vision"
          label={m.auth_register_member_vision()}
          error={errors().vision}
        />
        <FilePicker
          accept="application/pdf"
          name="contribution"
          label={m.auth_register_member_contribution()}
          error={errors().contribution}
        />

        <button
          type="submit"
          disabled={submitting()}
          class="h-11 rounded-md bg-accent hover:bg-accent-hover text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60"
        >
          {submitting() ? m.apply_submitting() : m.apply_submit()}
        </button>

        <div id="apply-status" aria-live="polite" class="min-h-5 text-sm">
          <Show when={serverError()}>
            {(message) => <p class="text-danger">{message()}</p>}
          </Show>
        </div>
      </form>
    </Show>
  )
}

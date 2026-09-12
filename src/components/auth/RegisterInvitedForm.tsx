import { useRouter } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { signUpInvited } from '../../lib/auth-actions'
import { SIGN_UP_ERROR_MESSAGE } from '../../lib/auth-messages'
import {
  isValidEssay,
  isValidName,
  isValidPassword,
  MIN_CONTRIBUTION_PLAN_CHARS,
} from '../../lib/validation'
import { m } from '../../paraglide/messages'

type Field = 'name' | 'password' | 'dateOfBirth' | 'essay' | 'contributionPlan'
type FieldErrors = Partial<Record<Field, string>>

const INPUT_CLASS =
  'h-11 px-3 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20'

/**
 * The cooptation registration form.
 *
 * No email field and no captcha. The address is fixed by the invitation, and a
 * token a senior member issued by hand to a named address is better evidence of
 * a real person than any challenge. The contribution plan is the one thing the
 * public dossier asks for that is kept: the six-month probation review has to
 * have something to measure the new member against.
 */
export default function RegisterInvitedForm(props: {
  token: string
  email: string
  sponsor: string | null
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = createSignal(false)
  const [serverError, setServerError] = createSignal<string | null>(null)
  const [errors, setErrors] = createSignal<FieldErrors>({})
  const [success, setSuccess] = createSignal(false)

  function validate(fd: FormData): FieldErrors {
    const errs: FieldErrors = {}
    if (!isValidName(String(fd.get('name') ?? ''))) {
      errs.name = m.auth_register_errors_nameInvalid()
    }
    if (!isValidPassword(String(fd.get('password') ?? ''))) {
      errs.password = m.auth_login_errors_passwordTooShort()
    }
    if (!String(fd.get('dateOfBirth') ?? '')) {
      errs.dateOfBirth = m.auth_register_errors_dobRequired()
    }
    if (!isValidEssay(String(fd.get('essay') ?? ''))) {
      errs.essay = m.auth_register_errors_essayTooShort()
    }
    if (
      String(fd.get('contributionPlan') ?? '').trim().length < MIN_CONTRIBUTION_PLAN_CHARS
    ) {
      errs.contributionPlan = m.auth_register_errors_invalidPlan()
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
      const result = await signUpInvited({
        data: {
          token: props.token,
          name: String(fd.get('name') ?? ''),
          password: String(fd.get('password') ?? ''),
          dateOfBirth: String(fd.get('dateOfBirth') ?? ''),
          essay: String(fd.get('essay') ?? ''),
          contributionPlan: String(fd.get('contributionPlan') ?? ''),
        },
      })
      if (!result.ok) {
        setServerError(SIGN_UP_ERROR_MESSAGE[result.code]())
        return
      }
      // Deliberately no `router.invalidate()` here, unlike the other
      // registration forms. Re-running this route's loader would re-check a
      // token that has just been spent, and the new member would watch their
      // confirmation be replaced by "invitation unusable".
      setSuccess(true)
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
          <button
            type="button"
            onClick={() => router.navigate({ to: '/auth/login' })}
            class="h-11 rounded-md bg-[#00209F] px-4 text-sm font-semibold text-white hover:opacity-95"
          >
            {m.auth_verify_goLogin()}
          </button>
        </div>
      }
    >
      <form
        class="flex flex-col gap-4"
        onSubmit={(e) => void onSubmit(e)}
        novalidate
        aria-describedby="register-status"
      >
        <Show when={props.sponsor}>
          {(sponsor) => (
            <p class="rounded-md bg-neutral-50 p-3 text-sm text-neutral-700">
              {m.email_invite_intro({ sponsor: sponsor() })}
            </p>
          )}
        </Show>

        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium text-neutral-800">{m.auth_login_email()}</span>
          {/* Read-only: the invitation decides the address. */}
          <input
            type="email"
            value={props.email}
            readonly
            class={`${INPUT_CLASS} bg-neutral-100 text-neutral-600`}
          />
          <span class="text-xs text-neutral-500">
            {m.auth_register_invited_emailFixed()}
          </span>
        </label>

        <TextInput
          name="name"
          type="text"
          autocomplete="name"
          label={m.auth_register_common_name()}
          error={errors().name}
        />
        <TextInput
          name="password"
          type="password"
          autocomplete="new-password"
          label={m.auth_login_password()}
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
            rows="4"
            class="rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
            aria-invalid={errors().essay ? 'true' : undefined}
          />
          <Show when={errors().essay}>
            {(message) => <span class="text-xs text-[#D21034]">{message()}</span>}
          </Show>
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium text-neutral-800">
            {m.auth_register_invited_planLabel()}
          </span>
          <span class="text-xs text-neutral-500">
            {m.auth_register_invited_planHint()}
          </span>
          <textarea
            id="contributionPlan"
            name="contributionPlan"
            rows="5"
            class="rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
            aria-invalid={errors().contributionPlan ? 'true' : undefined}
          />
          <Show when={errors().contributionPlan}>
            {(message) => <span class="text-xs text-[#D21034]">{message()}</span>}
          </Show>
        </label>

        <p class="text-xs text-neutral-500">{m.auth_register_invited_probationNote()}</p>

        <button
          type="submit"
          disabled={submitting()}
          class="h-11 rounded-md bg-linear-to-r from-[#00209F] to-[#D21034] text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60"
        >
          {submitting()
            ? m.auth_register_common_submitting()
            : m.auth_register_invited_submit()}
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
        aria-invalid={props.error ? 'true' : undefined}
      />
      <Show when={props.error}>
        {(message) => <span class="text-xs text-[#D21034]">{message()}</span>}
      </Show>
    </label>
  )
}

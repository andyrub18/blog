import { useRouter } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import {
  type VerifyCodeErrorCode,
  verifySignInCode,
} from '../../lib/auth/two-factor-actions'
import { m } from '../../paraglide/messages'

const INPUT_CLASS =
  'h-11 px-3 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20'

const ERROR_MESSAGE: Record<VerifyCodeErrorCode, () => string> = {
  INVALID_CODE: m.auth_2fa_errors_invalid,
  START_AGAIN: m.auth_2fa_errors_startAgain,
  LOCKED: m.auth_2fa_errors_locked,
  ACCOUNT_BLOCKED: m.auth_login_errors_accountBlocked,
  RATE_LIMITED: m.auth_login_errors_rateLimited,
  UNEXPECTED: m.auth_login_errors_unexpected,
}

/**
 * The second step of a sign-in, for an account that asks for a code (D40).
 *
 * The password has been accepted and Better Auth holds the pending sign-in in a
 * cookie for ten minutes. A code from the app finishes it; so does a backup
 * code, for somebody without their phone. When the pending sign-in is gone —
 * five wrong codes, or the ten minutes — the only way on is the password again,
 * so the form gives way to the password form.
 */
export default function TwoFactorStep(props: { onStartAgain: () => void }) {
  const router = useRouter()
  const [backup, setBackup] = createSignal(false)
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<VerifyCodeErrorCode | null>(null)

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault()
    const code = String(
      new FormData(e.currentTarget as HTMLFormElement).get('code') ?? '',
    )
    if (!code.trim()) return setError('INVALID_CODE')

    setSubmitting(true)
    setError(null)
    try {
      const result = await verifySignInCode({ data: { code, backup: backup() } })
      if (result.ok) {
        await router.navigate({ to: '/' })
        return
      }
      setError(result.code)
    } catch {
      setError('UNEXPECTED')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h2 class="font-serif text-2xl font-bold">{m.auth_2fa_title()}</h2>
      <p class="mt-2 text-[15px] text-ink-soft">
        {backup() ? m.auth_2fa_backupIntro() : m.auth_2fa_intro()}
      </p>
      <form
        class="mt-5 flex flex-col gap-4"
        onSubmit={(e) => void onSubmit(e)}
        novalidate
        aria-describedby="two-factor-status"
      >
        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium text-neutral-800">{m.auth_2fa_code()}</span>
          {/* Two inputs, not one restyled: switching clears what was typed for the
              other, and only the app's code is six digits for a numeric keypad. */}
          <Show
            when={backup()}
            fallback={
              <input
                name="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                class={`${INPUT_CLASS} tracking-[0.3em]`}
                aria-invalid={error() ? 'true' : undefined}
              />
            }
          >
            <input
              name="code"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              class={INPUT_CLASS}
              aria-invalid={error() ? 'true' : undefined}
            />
          </Show>
        </label>
        <button
          type="submit"
          disabled={submitting()}
          class="h-11 rounded-md bg-accent text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {submitting() ? m.auth_2fa_submitting() : m.auth_2fa_submit()}
        </button>
        <div id="two-factor-status" aria-live="polite" class="min-h-5 text-sm">
          <Show when={error()}>
            {(code) => <p class="text-danger">{ERROR_MESSAGE[code()]()}</p>}
          </Show>
        </div>
      </form>
      <div class="mt-2 flex flex-wrap justify-between gap-3 text-sm">
        <button
          type="button"
          class="font-semibold text-accent hover:underline"
          onClick={() => {
            setBackup(!backup())
            setError(null)
          }}
        >
          {backup() ? m.auth_2fa_useApp() : m.auth_2fa_useBackup()}
        </button>
        <Show when={error() === 'START_AGAIN' || error() === 'LOCKED'}>
          <button
            type="button"
            class="font-semibold text-accent hover:underline"
            onClick={() => props.onStartAgain()}
          >
            {m.auth_reset_backToLogin()}
          </button>
        </Show>
      </div>
    </div>
  )
}

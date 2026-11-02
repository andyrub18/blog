import { useRouter } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import {
  confirmTwoFactor,
  disableTwoFactor,
  renewBackupCodes,
  type SettingsErrorCode,
  startTwoFactor,
} from '../../lib/auth/two-factor-actions'
import { m } from '../../paraglide/messages'

const INPUT_CLASS =
  'h-11 px-3 rounded-md border border-neutral-300 bg-white text-neutral-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20'
const BUTTON_CLASS =
  'h-11 rounded-md bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60'
const QUIET_BUTTON_CLASS =
  'h-11 rounded-md border border-line px-5 text-sm font-semibold text-ink hover:border-accent-line disabled:opacity-60'

const ERROR_MESSAGE: Record<SettingsErrorCode, () => string> = {
  INVALID_PASSWORD: m.account_2fa_errors_password,
  INVALID_CODE: m.account_2fa_errors_code,
  RATE_LIMITED: m.auth_reset_errors_rateLimited,
  UNEXPECTED: m.auth_login_errors_unexpected,
}

type Setup = { uri: string; qr: string; secret: string; backupCodes: Array<string> }

/**
 * Turning codes at sign-in on and off (D40).
 *
 * On takes three steps on one screen: add the key to an app, keep the backup
 * codes, type the first code. Nothing changes at sign-in until that code is
 * accepted, so somebody who leaves halfway is not locked out by an app that was
 * never set up. Every change asks for the password; the reason is in
 * `two-factor-actions.ts`.
 */
export default function TwoFactorSettings(props: { enabled: boolean }) {
  const router = useRouter()
  const [state, setState] = createSignal<'off' | 'setup' | 'on'>(
    props.enabled ? 'on' : 'off',
  )
  const [setup, setSetup] = createSignal<Setup | null>(null)
  const [newCodes, setNewCodes] = createSignal<Array<string> | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<SettingsErrorCode | null>(null)

  /** Run one action with the form's fields, showing its refusal if it has one. */
  async function act(
    run: () => Promise<{ ok: true } | { ok: false; code: SettingsErrorCode }>,
  ) {
    setBusy(true)
    setError(null)
    try {
      const result = await run()
      if (!result.ok) setError(result.code)
      return result.ok
    } catch {
      setError('UNEXPECTED')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function begin(e: SubmitEvent) {
    e.preventDefault()
    const password = String(
      new FormData(e.currentTarget as HTMLFormElement).get('password') ?? '',
    )
    await act(async () => {
      const result = await startTwoFactor({ data: { password } })
      if (result.ok) {
        setSetup(result)
        setState('setup')
      }
      return result
    })
  }

  async function confirm(e: SubmitEvent) {
    e.preventDefault()
    const code = String(
      new FormData(e.currentTarget as HTMLFormElement).get('code') ?? '',
    )
    const done = await act(() => confirmTwoFactor({ data: { code } }))
    if (done) {
      setSetup(null)
      setState('on')
      // The session carries the setting; the layout reads it in `beforeLoad`.
      await router.invalidate()
    }
  }

  async function change(e: SubmitEvent) {
    e.preventDefault()
    const form = e.currentTarget as HTMLFormElement
    const password = String(new FormData(form).get('password') ?? '')
    const action = (e.submitter as HTMLButtonElement | null)?.value
    if (action === 'renew') {
      await act(async () => {
        const result = await renewBackupCodes({ data: { password } })
        if (result.ok) setNewCodes(result.backupCodes)
        return result
      })
    } else if (await act(() => disableTwoFactor({ data: { password } }))) {
      setNewCodes(null)
      setState('off')
      await router.invalidate()
    }
    form.reset()
  }

  return (
    <section class="rounded-2xl border border-line bg-raised p-6 sm:p-8">
      <h2 class="font-serif text-2xl font-bold">{m.account_2fa_heading()}</h2>
      <Show when={state() === 'off'}>
        <p class="mt-3 text-[15px] leading-relaxed text-ink-soft">
          {m.account_2fa_offIntro()}
        </p>
        <p class="mt-2 text-sm text-muted">{m.account_2fa_apps()}</p>
        <form
          class="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => void begin(e)}
        >
          <label class="flex flex-1 flex-col gap-1 text-sm">
            <span class="font-medium text-neutral-800">{m.auth_login_password()}</span>
            <input
              name="password"
              type="password"
              autocomplete="current-password"
              class={INPUT_CLASS}
            />
          </label>
          <button type="submit" disabled={busy()} class={BUTTON_CLASS}>
            {busy() ? m.account_2fa_working() : m.account_2fa_enable()}
          </button>
        </form>
      </Show>
      <Show when={state() === 'setup' && setup()}>
        {(current) => (
          <div class="mt-4 flex flex-col gap-6">
            <div>
              <p class="text-[15px] leading-relaxed">{m.account_2fa_step1()}</p>
              <div class="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                {/* An image the server drew, so the browser carries no QR code
                      library; white behind it in either theme, for the camera. */}
                <img
                  src={current().qr}
                  alt=""
                  width="176"
                  height="176"
                  class="rounded-lg bg-white p-2"
                />
                <div class="flex flex-col gap-2">
                  <a
                    href={current().uri}
                    class={`${QUIET_BUTTON_CLASS} inline-flex items-center`}
                  >
                    {m.account_2fa_openApp()}
                  </a>
                  <p class="text-sm text-muted">{m.account_2fa_manual()}</p>
                  <code data-testid="totp-secret" class="font-mono text-sm break-all">
                    {current()
                      .secret.replace(/(.{4})/g, '$1 ')
                      .trim()}
                  </code>
                </div>
              </div>
            </div>
            <div>
              <p class="text-[15px] leading-relaxed">{m.account_2fa_step2()}</p>
              <BackupCodes codes={current().backupCodes} />
            </div>
            <form
              class="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => void confirm(e)}
            >
              <label class="flex flex-1 flex-col gap-1 text-sm">
                <span class="text-[15px] text-ink">{m.account_2fa_step3()}</span>
                <input
                  name="code"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="6"
                  class={`${INPUT_CLASS} tracking-[0.3em]`}
                />
              </label>
              <button type="submit" disabled={busy()} class={BUTTON_CLASS}>
                {busy() ? m.account_2fa_working() : m.account_2fa_confirm()}
              </button>
            </form>
          </div>
        )}
      </Show>
      <Show when={state() === 'on'}>
        <p class="mt-3 text-[15px] leading-relaxed text-ink-soft">
          {m.account_2fa_onIntro()}
        </p>
        <Show when={newCodes()}>
          {(codes) => (
            <div class="mt-4">
              <p class="text-[15px]">{m.account_2fa_newCodes()}</p>
              <BackupCodes codes={codes()} />
            </div>
          )}
        </Show>
        <form class="mt-5 flex flex-col gap-3" onSubmit={(e) => void change(e)}>
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-neutral-800">{m.auth_login_password()}</span>
            <input
              name="password"
              type="password"
              autocomplete="current-password"
              aria-describedby="password-again"
              class={INPUT_CLASS}
            />
          </label>
          <p id="password-again" class="-mt-2 text-xs text-muted">
            {m.account_2fa_passwordAgain()}
          </p>
          <div class="flex flex-wrap gap-3">
            <button
              type="submit"
              value="renew"
              disabled={busy()}
              class={QUIET_BUTTON_CLASS}
            >
              {m.account_2fa_renew()}
            </button>
            <button
              type="submit"
              value="disable"
              disabled={busy()}
              class={QUIET_BUTTON_CLASS}
            >
              {m.account_2fa_disable()}
            </button>
          </div>
        </form>
        <p class="mt-5 text-sm text-muted">{m.account_2fa_lost()}</p>
      </Show>
      <p aria-live="polite" class="mt-3 min-h-5 text-sm text-danger">
        {error() ? ERROR_MESSAGE[error() as SettingsErrorCode]() : ''}
      </p>
    </section>
  )
}

/** The codes, as a list a person can copy or write down. */
function BackupCodes(props: { codes: Array<string> }) {
  return (
    <ul
      data-testid="backup-codes"
      class="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface p-4 font-mono text-sm sm:grid-cols-5"
    >
      <For each={props.codes}>{(code) => <li>{code}</li>}</For>
    </ul>
  )
}

import { createServerFn } from '@tanstack/solid-start'

/**
 * Two-factor sign-in: a code from an authenticator app as well as the password
 * (D40). Opt-in for now.
 *
 * Better Auth's own `/two-factor/*` endpoints are closed over HTTP (`auth.ts`);
 * these server functions are the only way in, each behind `guard()`, imported
 * inside the handler (`guard.ts`). Every one that changes the setting asks for
 * the password again: whoever finds a phone with an open session must not be
 * able to switch the second factor off, or on with their own app.
 */

export type VerifyCodeErrorCode =
  | 'INVALID_CODE'
  /** The pending sign-in is gone: too many tries, or ten minutes passed. */
  | 'START_AGAIN'
  /** Ten failures in a row: the account's codes rest for fifteen minutes. */
  | 'LOCKED'
  | 'ACCOUNT_BLOCKED'
  | 'RATE_LIMITED'
  | 'UNEXPECTED'

export type VerifyCodeResult = { ok: true } | { ok: false; code: VerifyCodeErrorCode }

export type SettingsErrorCode =
  | 'INVALID_PASSWORD'
  | 'INVALID_CODE'
  | 'RATE_LIMITED'
  | 'UNEXPECTED'

export type SetupResult =
  | {
      ok: true
      /** `otpauth://` link: opens the authenticator on the same phone. */
      uri: string
      /** The same link as a QR image, for a phone pointed at a computer. */
      qr: string
      /** The key itself, for typing in by hand. */
      secret: string
      backupCodes: Array<string>
    }
  | { ok: false; code: SettingsErrorCode }

export type SettingsResult = { ok: true } | { ok: false; code: SettingsErrorCode }

export type BackupCodesResult =
  | { ok: true; backupCodes: Array<string> }
  | { ok: false; code: SettingsErrorCode }

/** Better Auth's refusal code, or nothing if it is not one of its errors. */
async function refusal(err: unknown): Promise<string | undefined> {
  const { APIError } = await import('better-auth/api')
  return err instanceof APIError
    ? (err.body as { code?: string } | undefined)?.code
    : undefined
}

/**
 * The second step of a sign-in, with a code from the app or a backup code.
 *
 * Better Auth finds the pending sign-in from the cookie it set when the password
 * was accepted, checks the code, and opens the session. What it does not know
 * about is ours: a blocked account is refused here as it is after a password,
 * by name, and the sign-in counters are cleared only now that the sign-in is
 * actually complete.
 */
export const verifySignInCode = createServerFn({ method: 'POST' })
  .validator((data: { code: string; backup: boolean }) => {
    const code = String(data?.code ?? '').replace(/\s+/g, '')
    if (!code) throw new Error('INVALID_CODE')
    return { code, backup: data?.backup === true }
  })
  .handler(async ({ data }): Promise<VerifyCodeResult> => {
    const { guard } = await import('./guard')
    const gate = await guard({ action: 'verifyTwoFactor' })
    if (!gate.ok) return { ok: false, code: 'RATE_LIMITED' }

    const [{ getRequest }, { auth }] = await Promise.all([
      import('@tanstack/solid-start/server'),
      import('./auth'),
    ])
    const headers = getRequest().headers
    let user: { email: string; memberStatus?: string }
    try {
      const result = data.backup
        ? await auth.api.verifyBackupCode({ body: { code: data.code }, headers })
        : await auth.api.verifyTOTP({ body: { code: data.code }, headers })
      user = result.user as { email: string; memberStatus?: string }
    } catch (err) {
      const raw = await refusal(err)
      if (raw === 'INVALID_CODE' || raw === 'INVALID_BACKUP_CODE') {
        return { ok: false, code: 'INVALID_CODE' }
      }
      if (raw === 'ACCOUNT_TEMPORARILY_LOCKED') return { ok: false, code: 'LOCKED' }
      if (
        raw === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' ||
        raw === 'INVALID_TWO_FACTOR_COOKIE'
      ) {
        return { ok: false, code: 'START_AGAIN' }
      }
      return { ok: false, code: 'UNEXPECTED' }
    }

    if (user.memberStatus === 'blocked') {
      await auth.api.signOut({ headers })
      return { ok: false, code: 'ACCOUNT_BLOCKED' }
    }
    const { reset } = await import('../shared/rate-limit')
    await Promise.all([
      reset(`sign-in:email:${user.email}`),
      reset(`signIn:ip:${gate.ip}`),
    ])
    return { ok: true }
  })

/**
 * Throttle a settings change by connection and by account, then hand over the
 * signed-in user. `requireUser` sends anybody else to sign in.
 */
async function settingsGate(): Promise<
  { ok: true; headers: Headers } | { ok: false; code: 'RATE_LIMITED' }
> {
  const [{ requireUser }, { guard }, { RULES }, { getRequest }] = await Promise.all([
    import('./session.server'),
    import('./guard'),
    import('../shared/rate-limit'),
    import('@tanstack/solid-start/server'),
  ])
  const user = await requireUser()
  const gate = await guard({
    action: 'twoFactorSettings',
    extraKey: `two-factor:user:${user.id}`,
    extraRule: RULES.twoFactorSettingsPerAccount,
  })
  if (!gate.ok) return { ok: false, code: 'RATE_LIMITED' }
  return { ok: true, headers: getRequest().headers }
}

/**
 * Begin turning codes on: a new key, as a link, a QR image and text, and ten
 * backup codes. Nothing changes at sign-in until `confirmTwoFactor` has seen a
 * code made from the key, which is the proof the app was set up right.
 *
 * The QR image is drawn here, on the server, so the browser carries no QR
 * library; it arrives as an SVG data URL for an `<img>`, never as markup.
 */
export const startTwoFactor = createServerFn({ method: 'POST' })
  .validator((data: { password: string }) => ({ password: String(data?.password ?? '') }))
  .handler(async ({ data }): Promise<SetupResult> => {
    const gate = await settingsGate()
    if (!gate.ok) return gate
    const { auth } = await import('./auth')
    try {
      const result = await auth.api.enableTwoFactor({
        body: { password: data.password },
        headers: gate.headers,
      })
      const { totpURI, backupCodes } = result as {
        totpURI: string
        backupCodes: Array<string>
      }
      const { renderSVG } = await import('uqr')
      const svg = renderSVG(totpURI, { border: 2 })
      return {
        ok: true,
        uri: totpURI,
        qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
        secret: new URL(totpURI).searchParams.get('secret') ?? '',
        backupCodes,
      }
    } catch (err) {
      const raw = await refusal(err)
      if (raw === 'INVALID_PASSWORD') return { ok: false, code: 'INVALID_PASSWORD' }
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

/** Finish turning codes on, with the first code the app shows. */
export const confirmTwoFactor = createServerFn({ method: 'POST' })
  .validator((data: { code: string }) => ({
    code: String(data?.code ?? '').replace(/\s+/g, ''),
  }))
  .handler(async ({ data }): Promise<SettingsResult> => {
    const gate = await settingsGate()
    if (!gate.ok) return gate
    const { auth } = await import('./auth')
    try {
      await auth.api.verifyTOTP({ body: { code: data.code }, headers: gate.headers })
      return { ok: true }
    } catch (err) {
      const raw = await refusal(err)
      if (raw === 'INVALID_CODE') return { ok: false, code: 'INVALID_CODE' }
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

/** Turn codes off. The password again, for the reason at the top. */
export const disableTwoFactor = createServerFn({ method: 'POST' })
  .validator((data: { password: string }) => ({ password: String(data?.password ?? '') }))
  .handler(async ({ data }): Promise<SettingsResult> => {
    const gate = await settingsGate()
    if (!gate.ok) return gate
    const { auth } = await import('./auth')
    try {
      await auth.api.disableTwoFactor({
        body: { password: data.password },
        headers: gate.headers,
      })
      return { ok: true }
    } catch (err) {
      const raw = await refusal(err)
      if (raw === 'INVALID_PASSWORD') return { ok: false, code: 'INVALID_PASSWORD' }
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

/** Ten new backup codes; the old ones stop working. */
export const renewBackupCodes = createServerFn({ method: 'POST' })
  .validator((data: { password: string }) => ({ password: String(data?.password ?? '') }))
  .handler(async ({ data }): Promise<BackupCodesResult> => {
    const gate = await settingsGate()
    if (!gate.ok) return gate
    const { auth } = await import('./auth')
    try {
      const result = await auth.api.generateBackupCodes({
        body: { password: data.password },
        headers: gate.headers,
      })
      return { ok: true, backupCodes: result.backupCodes }
    } catch (err) {
      const raw = await refusal(err)
      if (raw === 'INVALID_PASSWORD') return { ok: false, code: 'INVALID_PASSWORD' }
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

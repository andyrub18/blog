import { createServerFn } from '@tanstack/solid-start'
import { EMAIL_RE, isValidPassword } from '../shared/validation'

/**
 * Password recovery: ask for a link, then choose a new password with it.
 *
 * Kept out of `auth-actions.ts` because that module is in every page's bundle
 * (the header's sign-out button imports it), and each server function there is
 * a stub every reader downloads.
 *
 * `guard` is imported inside each handler, never at the top (`guard.ts`).
 */

export type RequestResetResult = { ok: true } | { ok: false; code: 'RATE_LIMITED' }

export type ResetPasswordErrorCode =
  | 'RATE_LIMITED'
  | 'INVALID_TOKEN'
  | 'INVALID_PASSWORD'
  | 'UNEXPECTED'

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; code: ResetPasswordErrorCode }

/**
 * Send a reset link, if the address has an account.
 *
 * The answer is the same whether it does or not, and so is its timing (see
 * `sendResetPassword` in `auth.ts`): a form that says "no such account" lets
 * anybody check whether an address belongs to a member of the movement, which
 * is the roster CLAUDE.md says must not leak. Even a failure inside Better Auth
 * is answered as a success, because a failure only an existing account can
 * cause would say the same thing.
 */
export const requestPasswordReset = createServerFn({ method: 'POST' })
  .validator((data: { email: string }) => {
    const email = (data?.email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) throw new Error('INVALID_EMAIL')
    return { email }
  })
  .handler(async ({ data }): Promise<RequestResetResult> => {
    const [{ guard }, { RULES }] = await Promise.all([
      import('./guard'),
      import('../shared/rate-limit'),
    ])
    const gate = await guard({
      action: 'requestPasswordReset',
      extraKey: `reset:email:${data.email}`,
      extraRule: RULES.requestPasswordResetPerEmail,
    })
    if (!gate.ok) return { ok: false, code: 'RATE_LIMITED' }

    const [{ getRequest }, { auth }, { resolveRequestLocale }, { localizeHref }] =
      await Promise.all([
        import('@tanstack/solid-start/server'),
        import('./auth'),
        import('../email/locale'),
        import('../../paraglide/runtime'),
      ])
    try {
      await auth.api.requestPasswordReset({
        body: {
          email: data.email,
          // The page the link lands on, in the language the mail is written in
          // (D23). Unprefixed, the reader's browser would choose.
          redirectTo: localizeHref('/auth/reset-password', {
            locale: resolveRequestLocale(),
          }),
        },
        headers: getRequest().headers,
      })
    } catch {
      // Answered as a success; see above.
    }
    return { ok: true }
  })

/**
 * Set a new password with the token from the link.
 *
 * Better Auth checks the token, consumes it, and signs out every session the
 * account had (`revokeSessionsOnPasswordReset` in `auth.ts`). It does not sign
 * the person in: they do that with the new password, which is also the proof
 * they typed what they meant to.
 */
export const resetPassword = createServerFn({ method: 'POST' })
  .validator((data: { token: string; password: string }) => {
    const token = (data?.token ?? '').trim()
    if (!token) throw new Error('INVALID_TOKEN')
    if (!isValidPassword(data?.password)) throw new Error('INVALID_PASSWORD')
    return { token, password: data.password }
  })
  .handler(async ({ data }): Promise<ResetPasswordResult> => {
    const { guard } = await import('./guard')
    const gate = await guard({ action: 'resetPassword' })
    if (!gate.ok) return { ok: false, code: 'RATE_LIMITED' }

    const [{ getRequest }, { APIError }, { auth }] = await Promise.all([
      import('@tanstack/solid-start/server'),
      import('better-auth/api'),
      import('./auth'),
    ])
    try {
      await auth.api.resetPassword({
        body: { newPassword: data.password, token: data.token },
        headers: getRequest().headers,
      })
      return { ok: true }
    } catch (err) {
      if (err instanceof APIError) {
        const raw = (err.body as { code?: string } | undefined)?.code
        if (raw === 'INVALID_TOKEN' || raw === 'USER_NOT_FOUND') {
          return { ok: false, code: 'INVALID_TOKEN' }
        }
        if (raw === 'PASSWORD_TOO_SHORT' || raw === 'PASSWORD_TOO_LONG') {
          return { ok: false, code: 'INVALID_PASSWORD' }
        }
      }
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

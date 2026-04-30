import { createServerFn } from '@tanstack/solid-start'

export type SignInErrorCode =
  | 'INVALID_EMAIL_OR_PASSWORD'
  | 'INVALID_EMAIL'
  | 'INVALID_PASSWORD'
  | 'EMAIL_NOT_VERIFIED'
  | 'USER_NOT_FOUND'
  | 'CREDENTIAL_ACCOUNT_NOT_FOUND'
  | 'FAILED_TO_CREATE_SESSION'
  | 'UNEXPECTED'

export type SignInResult =
  | { ok: true; user: { id: string; email: string; name: string } }
  | { ok: false; code: SignInErrorCode }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const signInWithPassword = createServerFn({ method: 'POST' })
  .inputValidator((data: { email: string; password: string }) => {
    if (!data || typeof data.email !== 'string' || typeof data.password !== 'string') {
      throw new Error('Invalid payload.')
    }
    const email = data.email.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) throw new Error('INVALID_EMAIL')
    if (data.password.length < 8) throw new Error('INVALID_PASSWORD')
    return { email, password: data.password }
  })
  .handler(async ({ data }): Promise<SignInResult> => {
    const [{ getRequest }, { APIError }, { auth }] = await Promise.all([
      import('@tanstack/solid-start/server'),
      import('better-auth/api'),
      import('./auth'),
    ])
    try {
      const result = await auth.api.signInEmail({
        body: { email: data.email, password: data.password },
        headers: getRequest().headers,
      })
      return {
        ok: true,
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
        },
      }
    } catch (err) {
      if (err instanceof APIError) {
        const raw = (err.body as { code?: string } | undefined)?.code
        const code = isKnownCode(raw) ? raw : 'INVALID_EMAIL_OR_PASSWORD'
        return { ok: false, code }
      }
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

const KNOWN_CODES: ReadonlySet<SignInErrorCode> = new Set([
  'INVALID_EMAIL_OR_PASSWORD',
  'INVALID_EMAIL',
  'INVALID_PASSWORD',
  'EMAIL_NOT_VERIFIED',
  'USER_NOT_FOUND',
  'CREDENTIAL_ACCOUNT_NOT_FOUND',
  'FAILED_TO_CREATE_SESSION',
  'UNEXPECTED',
])

function isKnownCode(value: unknown): value is SignInErrorCode {
  return typeof value === 'string' && KNOWN_CODES.has(value as SignInErrorCode)
}



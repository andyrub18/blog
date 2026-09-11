import { createServerFn } from '@tanstack/solid-start'
import {
  EMAIL_RE,
  isValidEssay,
  isValidName,
  isValidPassword,
  meetsMinimumAge,
  parseDateOfBirth,
} from './validation'

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

export type SignUpErrorCode =
  | 'INVALID_EMAIL'
  | 'INVALID_PASSWORD'
  | 'INVALID_NAME'
  | 'INVALID_DATE_OF_BIRTH'
  | 'TOO_YOUNG'
  | 'INVALID_ESSAY'
  | 'INVALID_PDF'
  | 'PDF_TOO_LARGE'
  | 'EMAIL_ALREADY_EXISTS'
  | 'UNEXPECTED'

export type SignUpResult =
  | { ok: true; userId: string; needsVerification: boolean }
  | { ok: false; code: SignUpErrorCode }

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
        const code = isKnownSignInCode(raw) ? raw : 'INVALID_EMAIL_OR_PASSWORD'
        return { ok: false, code }
      }
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

export const signUpReader = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      name: string
      email: string
      password: string
      dateOfBirth: string
      essay: string
    }) => {
      if (!data || typeof data !== 'object') throw new Error('Invalid payload.')
      const name = (data.name ?? '').trim()
      const email = (data.email ?? '').trim().toLowerCase()
      const essay = (data.essay ?? '').trim()
      if (!isValidName(name)) throw new Error('INVALID_NAME')
      if (!EMAIL_RE.test(email)) throw new Error('INVALID_EMAIL')
      if (!isValidPassword(data.password)) throw new Error('INVALID_PASSWORD')
      const dob = parseDateOfBirth(data.dateOfBirth)
      if (!dob) throw new Error('INVALID_DATE_OF_BIRTH')
      if (!meetsMinimumAge(dob)) throw new Error('TOO_YOUNG')
      if (!isValidEssay(essay)) throw new Error('INVALID_ESSAY')
      return {
        name,
        email,
        password: data.password,
        dateOfBirth: dob.toISOString(),
        essay,
      }
    },
  )
  .handler(async ({ data }): Promise<SignUpResult> => {
    return await runSignUp({
      name: data.name,
      email: data.email,
      password: data.password,
      dateOfBirth: data.dateOfBirth,
      essay: data.essay,
    })
  })

export const signUpMember = createServerFn({ method: 'POST' })
  .inputValidator((formData: FormData) => {
    if (!(formData instanceof FormData)) throw new Error('Invalid payload.')
    const get = (k: string) => {
      const v = formData.get(k)
      return typeof v === 'string' ? v : ''
    }
    const file = (k: string) => {
      const v = formData.get(k)
      return v instanceof File ? v : null
    }
    const name = get('name').trim()
    const email = get('email').trim().toLowerCase()
    const password = get('password')
    const essay = get('essay').trim()
    const dobRaw = get('dateOfBirth')
    if (!isValidName(name)) throw new Error('INVALID_NAME')
    if (!EMAIL_RE.test(email)) throw new Error('INVALID_EMAIL')
    if (!isValidPassword(password)) throw new Error('INVALID_PASSWORD')
    const dob = parseDateOfBirth(dobRaw)
    if (!dob) throw new Error('INVALID_DATE_OF_BIRTH')
    if (!meetsMinimumAge(dob)) throw new Error('TOO_YOUNG')
    if (!isValidEssay(essay)) throw new Error('INVALID_ESSAY')
    return {
      name,
      email,
      password,
      dateOfBirth: dob.toISOString(),
      essay,
      cv: file('cv'),
      vision: file('vision'),
      contribution: file('contribution'),
    }
  })
  .handler(async ({ data }): Promise<SignUpResult> => {
    const {
      stageApplicationPdf,
      commitApplicationPdf,
      discardApplicationUploads,
      UploadError,
    } = await import('./uploads')
    const { db } = await import('./db')
    const { memberApplication } = await import('./db/schema')
    const { randomUUID } = await import('node:crypto')

    // Validate and hold every file in memory BEFORE creating the account.
    // Creating the user first meant a failed upload left a stranded account
    // with no application, which could never be completed or re-applied for.
    let staged: Array<Awaited<ReturnType<typeof stageApplicationPdf>>>
    try {
      staged = [
        await stageApplicationPdf('cv', data.cv),
        await stageApplicationPdf('vision', data.vision),
        await stageApplicationPdf('contribution', data.contribution),
      ]
    } catch (err) {
      if (err instanceof UploadError) {
        return {
          ok: false,
          code: err.code === 'FILE_TOO_LARGE' ? 'PDF_TOO_LARGE' : 'INVALID_PDF',
        }
      }
      return { ok: false, code: 'UNEXPECTED' }
    }

    const result = await runSignUp({
      name: data.name,
      email: data.email,
      password: data.password,
      dateOfBirth: data.dateOfBirth,
      essay: data.essay,
    })
    if (!result.ok) return result

    // The account now exists. If anything below fails we must undo it, or the
    // applicant is stuck with an account they cannot attach an application to.
    try {
      const [cvPath, visionEssayPath, contributionEssayPath] = await Promise.all(
        staged.map((file) => commitApplicationPdf(result.userId, file)),
      )
      await db.insert(memberApplication).values({
        id: randomUUID(),
        userId: result.userId,
        cvPath,
        visionEssayPath,
        contributionEssayPath,
      })
      return result
    } catch {
      await rollbackFailedApplication(result.userId, discardApplicationUploads)
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

export const signOut = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ ok: boolean }> => {
    const [{ getRequest }, { auth }] = await Promise.all([
      import('@tanstack/solid-start/server'),
      import('./auth'),
    ])
    try {
      await auth.api.signOut({ headers: getRequest().headers })
      return { ok: true }
    } catch {
      return { ok: false }
    }
  },
)

export const mockGoogleSignIn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ ok: false; code: 'NOT_IMPLEMENTED' }> => {
    return { ok: false, code: 'NOT_IMPLEMENTED' }
  },
)

export const resendVerificationEmail = createServerFn({ method: 'POST' })
  .inputValidator((data: { email: string }) => {
    const email = (data?.email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) throw new Error('INVALID_EMAIL')
    return { email }
  })
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const [{ getRequest }, { auth }] = await Promise.all([
      import('@tanstack/solid-start/server'),
      import('./auth'),
    ])
    try {
      await auth.api.sendVerificationEmail({
        body: { email: data.email },
        headers: getRequest().headers,
      })
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

/**
 * Undo a member signup whose application could not be stored.
 *
 * Better Auth creates the user outside our database transaction, so true
 * atomicity is not available. The next best thing is a compensating delete so
 * the applicant can simply try again with the same email address.
 */
async function rollbackFailedApplication(
  userId: string,
  discardUploads: (userId: string) => Promise<void>,
): Promise<void> {
  try {
    await discardUploads(userId)
    const [{ db }, { user }, { eq }] = await Promise.all([
      import('./db'),
      import('./db/schema'),
      import('drizzle-orm'),
    ])
    await db.delete(user).where(eq(user.id, userId))
  } catch {
    // Nothing further we can do here; the audit log is the backstop.
  }
}

async function runSignUp(input: {
  name: string
  email: string
  password: string
  dateOfBirth: string
  essay: string
}): Promise<SignUpResult> {
  const [{ getRequest }, { APIError }, { auth }] = await Promise.all([
    import('@tanstack/solid-start/server'),
    import('better-auth/api'),
    import('./auth'),
  ])
  try {
    const result = await auth.api.signUpEmail({
      body: {
        name: input.name,
        email: input.email,
        password: input.password,
        dateOfBirth: new Date(input.dateOfBirth),
        essay: input.essay,
      },
      headers: getRequest().headers,
    })
    return {
      ok: true,
      userId: result.user.id,
      needsVerification: !result.user.emailVerified,
    }
  } catch (err) {
    if (err instanceof APIError) {
      const raw = (err.body as { code?: string } | undefined)?.code
      if (raw === 'USER_ALREADY_EXISTS' || raw === 'EMAIL_ALREADY_EXISTS') {
        return { ok: false, code: 'EMAIL_ALREADY_EXISTS' }
      }
    }
    return { ok: false, code: 'UNEXPECTED' }
  }
}

const KNOWN_SIGNIN_CODES: ReadonlySet<SignInErrorCode> = new Set([
  'INVALID_EMAIL_OR_PASSWORD',
  'INVALID_EMAIL',
  'INVALID_PASSWORD',
  'EMAIL_NOT_VERIFIED',
  'USER_NOT_FOUND',
  'CREDENTIAL_ACCOUNT_NOT_FOUND',
  'FAILED_TO_CREATE_SESSION',
  'UNEXPECTED',
])

function isKnownSignInCode(value: unknown): value is SignInErrorCode {
  return typeof value === 'string' && KNOWN_SIGNIN_CODES.has(value as SignInErrorCode)
}

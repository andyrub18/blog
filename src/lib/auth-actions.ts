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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_AGE_YEARS = 13
const MIN_ESSAY_CHARS = 50

function isAdult(dob: Date): boolean {
  const now = new Date()
  const age = now.getFullYear() - dob.getFullYear() -
    (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0)
  return age >= MIN_AGE_YEARS
}

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
      if (name.length < 2) throw new Error('INVALID_NAME')
      if (!EMAIL_RE.test(email)) throw new Error('INVALID_EMAIL')
      if (typeof data.password !== 'string' || data.password.length < 8) {
        throw new Error('INVALID_PASSWORD')
      }
      const dob = data.dateOfBirth ? new Date(data.dateOfBirth) : null
      if (!dob || Number.isNaN(dob.getTime())) throw new Error('INVALID_DATE_OF_BIRTH')
      if (!isAdult(dob)) throw new Error('TOO_YOUNG')
      if (essay.length < MIN_ESSAY_CHARS) throw new Error('INVALID_ESSAY')
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
    if (name.length < 2) throw new Error('INVALID_NAME')
    if (!EMAIL_RE.test(email)) throw new Error('INVALID_EMAIL')
    if (password.length < 8) throw new Error('INVALID_PASSWORD')
    const dob = dobRaw ? new Date(dobRaw) : null
    if (!dob || Number.isNaN(dob.getTime())) throw new Error('INVALID_DATE_OF_BIRTH')
    if (!isAdult(dob)) throw new Error('TOO_YOUNG')
    if (essay.length < MIN_ESSAY_CHARS) throw new Error('INVALID_ESSAY')
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
    const { saveMemberApplicationPdf, UploadError } = await import('./uploads')
    const { db } = await import('./db')
    const { memberApplication } = await import('./db/schema')
    const { randomUUID } = await import('node:crypto')

    const result = await runSignUp({
      name: data.name,
      email: data.email,
      password: data.password,
      dateOfBirth: data.dateOfBirth,
      essay: data.essay,
    })
    if (!result.ok) return result

    try {
      const cvPath = await saveMemberApplicationPdf(result.userId, 'cv', data.cv)
      const visionEssayPath = await saveMemberApplicationPdf(
        result.userId,
        'vision',
        data.vision,
      )
      const contributionEssayPath = await saveMemberApplicationPdf(
        result.userId,
        'contribution',
        data.contribution,
      )
      await db.insert(memberApplication).values({
        id: randomUUID(),
        userId: result.userId,
        cvPath,
        visionEssayPath,
        contributionEssayPath,
      })
      return result
    } catch (err) {
      if (err instanceof UploadError) {
        return {
          ok: false,
          code: err.code === 'FILE_TOO_LARGE' ? 'PDF_TOO_LARGE' : 'INVALID_PDF',
        }
      }
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




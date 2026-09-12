import { createServerFn } from '@tanstack/solid-start'
import type { RateLimitAction, RateLimitRule } from './rate-limit'
import {
  EMAIL_RE,
  isValidEssay,
  isValidName,
  isValidPassword,
  MIN_CONTRIBUTION_PLAN_CHARS,
  meetsMinimumAge,
  parseDateOfBirth,
} from './validation'

export type SignInErrorCode =
  | 'RATE_LIMITED'
  | 'ACCOUNT_BLOCKED'
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
  | 'RATE_LIMITED'
  | 'CAPTCHA_FAILED'
  | 'INVITATION_NOT_FOUND'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_ALREADY_USED'
  | 'INVITATION_REVOKED'
  | 'INVALID_PLAN'
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

export type ApplyErrorCode =
  | 'NOT_SIGNED_IN'
  | 'ALREADY_MEMBER'
  | 'APPLICATION_OPEN'
  | 'EMAIL_UNVERIFIED'
  | 'INVALID_PLAN'
  | 'INVALID_PDF'
  | 'PDF_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'UNEXPECTED'

export type ApplyResult =
  | { ok: true; applicationId: string }
  | { ok: false; code: ApplyErrorCode }

/**
 * Throttle and bot-check a request before it reaches Better Auth.
 *
 * Better Auth's own rate limiting and captcha plugin hook `onRequest`, so they
 * only cover traffic that arrives at `/api/auth/*`. These flows call
 * `auth.api.*` directly from a server function, which never touches that path —
 * so the protection has to live here or it does not exist at all.
 */
async function guard(input: {
  action: RateLimitAction
  captchaToken?: string | null
  extraKey?: string
  extraRule?: RateLimitRule
}): Promise<
  { ok: true; ip: string } | { ok: false; code: 'RATE_LIMITED' | 'CAPTCHA_FAILED' }
> {
  const [{ getRequest }, { consume, clientIp, RULES: R }] = await Promise.all([
    import('@tanstack/solid-start/server'),
    import('./rate-limit'),
  ])
  const headers = getRequest().headers
  const ip = clientIp(headers)

  const byIp = await consume(`${input.action}:ip:${ip}`, R[input.action])
  if (!byIp.allowed) return { ok: false, code: 'RATE_LIMITED' }

  if (input.extraKey && input.extraRule) {
    const extra = await consume(input.extraKey, input.extraRule)
    if (!extra.allowed) return { ok: false, code: 'RATE_LIMITED' }
  }

  if (input.captchaToken !== undefined) {
    const { verifyCaptcha } = await import('./captcha')
    const result = await verifyCaptcha(input.captchaToken, ip)
    if (!result.ok) return { ok: false, code: 'CAPTCHA_FAILED' }
  }

  return { ok: true, ip }
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
    const { RULES } = await import('./rate-limit')
    // Per-email as well as per-IP: credential stuffing against one targeted
    // member is exactly the threat here, and it arrives from many addresses.
    // Only failures count, and a success clears it, so this cannot be used to
    // lock a member out of their own account by guessing at them.
    const emailKey = `sign-in:email:${data.email}`
    const gate = await guard({
      action: 'signIn',
      extraKey: emailKey,
      extraRule: RULES.signInPerEmail,
    })
    if (!gate.ok) return { ok: false, code: gate.code as 'RATE_LIMITED' }

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

      // Say so plainly rather than failing as a bad password. Someone who has
      // been blocked is owed the reason, and letting them think they mistyped
      // their password would have them reset it over and over.
      if ((result.user as { memberStatus?: string }).memberStatus === 'blocked') {
        await auth.api.signOut({ headers: getRequest().headers })
        return { ok: false, code: 'ACCOUNT_BLOCKED' }
      }

      // Clear both counters: only failed attempts should count against anyone.
      // Leaving the per-IP counter consumed would mean a household or a
      // cybercafé signing in normally could exhaust it between them.
      const { reset } = await import('./rate-limit')
      await Promise.all([reset(emailKey), reset(`signIn:ip:${gate.ip}`)])
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
      captchaToken?: string
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
        captchaToken: data.captchaToken,
      }
    },
  )
  .handler(async ({ data }): Promise<SignUpResult> => {
    const gate = await guard({
      action: 'signUp',
      captchaToken: data.captchaToken ?? null,
    })
    if (!gate.ok) return { ok: false, code: gate.code }

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

    // No captcha here, deliberately. This form already asks for three PDFs,
    // two essays and a human review; that friction filters automated abuse far
    // better than a challenge does, and a captcha would only tax the most
    // committed applicants. Volume abuse is a rate-limiting problem, which the
    // per-IP counter below handles.
    const gate = await guard({ action: 'signUp' })
    if (!gate.ok) return { ok: false, code: gate.code }

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

/**
 * Create an account from an invitation — the manifesto's *cooptation*.
 *
 * What this skips is the committee review: the sponsoring senior member's
 * judgement replaces it, and their name is on the record. What it deliberately
 * keeps is everything that protects the movement afterwards — email
 * verification, the contribution plan the probation review needs, the six-month
 * probation itself, and the audit row naming the sponsor.
 *
 * No captcha, and not for the usual reason: a valid invitation token is a
 * stronger proof of humanity than any challenge, because a senior member issued
 * it by hand to an address they chose. Rate limiting still applies.
 *
 * The email address comes from the invitation, never from the form. Taking it
 * from the form would turn one invitation into an account in any name at all.
 */
export const signUpInvited = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      token: string
      name: string
      password: string
      dateOfBirth: string
      essay: string
      contributionPlan: string
    }) => {
      if (!data || typeof data !== 'object') throw new Error('Invalid payload.')
      const name = (data.name ?? '').trim()
      const essay = (data.essay ?? '').trim()
      const plan = (data.contributionPlan ?? '').trim()
      const token = (data.token ?? '').trim()
      if (!token) throw new Error('INVITATION_NOT_FOUND')
      if (!isValidName(name)) throw new Error('INVALID_NAME')
      if (!isValidPassword(data.password)) throw new Error('INVALID_PASSWORD')
      const dob = parseDateOfBirth(data.dateOfBirth)
      if (!dob) throw new Error('INVALID_DATE_OF_BIRTH')
      if (!meetsMinimumAge(dob)) throw new Error('TOO_YOUNG')
      if (!isValidEssay(essay)) throw new Error('INVALID_ESSAY')
      if (plan.length < MIN_CONTRIBUTION_PLAN_CHARS) throw new Error('INVALID_PLAN')
      return {
        token,
        name,
        password: data.password,
        dateOfBirth: dob.toISOString(),
        essay,
        contributionPlan: plan,
      }
    },
  )
  .handler(async ({ data }): Promise<SignUpResult> => {
    const gate = await guard({ action: 'signUp' })
    if (!gate.ok) return { ok: false, code: gate.code }

    const { checkInvitation, consumeInvitation } = await import('./invitation')
    const checked = await checkInvitation(data.token)
    if (!checked.ok) {
      return { ok: false, code: INVITATION_CODE[checked.code] ?? 'INVITATION_NOT_FOUND' }
    }
    const invite = checked.invitation

    const result = await runSignUp({
      name: data.name,
      email: invite.email,
      password: data.password,
      dateOfBirth: data.dateOfBirth,
      essay: data.essay,
    })
    if (!result.ok) return result

    // Dynamic, like every other server-only import here: a static one would
    // pull the driver and the schema into the browser bundle.
    const [{ db }, schema, { randomUUID }, { probationEnd }, { eq }] = await Promise.all([
      import('./db'),
      import('./db/schema'),
      import('node:crypto'),
      import('./review'),
      import('drizzle-orm'),
    ])

    try {
      const now = new Date()
      await db.transaction(async (tx) => {
        // Conditional on the invitation still being unused, so two people
        // opening the same link at once cannot both end up with an account.
        const claimed = await consumeInvitation(tx, {
          invitationId: invite.id,
          userId: result.userId,
          now,
        })
        if (!claimed) throw new Error('INVITATION_ALREADY_USED')

        const applicationId = randomUUID()
        await tx.insert(schema.memberApplication).values({
          id: applicationId,
          userId: result.userId,
          contributionPlan: data.contributionPlan,
          status: 'approved',
          origin: 'invitation',
          decisionRationale: invite.note,
          reviewedBy: invite.invitedBy,
          reviewedAt: now,
        })
        await tx.insert(schema.applicationEvent).values({
          id: randomUUID(),
          applicationId,
          fromStatus: null,
          toStatus: 'approved',
          rationale: invite.note,
          actorId: invite.invitedBy,
        })

        await tx
          .update(schema.user)
          .set({
            role: 'member',
            memberSince: now,
            probationUntil: probationEnd(now),
            sponsoredBy: invite.invitedBy,
            updatedAt: now,
          })
          .where(eq(schema.user.id, result.userId))

        await tx.insert(schema.roleChange).values({
          id: randomUUID(),
          subjectUserId: result.userId,
          fromRole: 'reader',
          toRole: 'member',
          reason: 'invitation_accepted',
          rationale: invite.note,
          // The sponsor, not the new member: if this turns out badly the
          // movement can see who vouched, which is what cooptation costs.
          actorId: invite.invitedBy,
        })
      })
      return result
    } catch (err) {
      await rollbackFailedApplication(result.userId, async () => {})
      if (err instanceof Error && err.message === 'INVITATION_ALREADY_USED') {
        return { ok: false, code: 'INVITATION_ALREADY_USED' }
      }
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

const INVITATION_CODE: Record<string, SignUpErrorCode> = {
  NOT_FOUND: 'INVITATION_NOT_FOUND',
  EXPIRED: 'INVITATION_EXPIRED',
  ALREADY_USED: 'INVITATION_ALREADY_USED',
  REVOKED: 'INVITATION_REVOKED',
}

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
    // Unthrottled, this is a free way to mail-bomb any address on demand.
    const gate = await guard({ action: 'resendVerification' })
    if (!gate.ok) return { ok: false }

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
  'ACCOUNT_BLOCKED',
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

/**
 * Apply for membership from an account that already exists.
 *
 * The promotion path a reader takes after taking part for a while. Distinct
 * from `signUpMember`, which creates an account and an application together —
 * calling that as an existing reader fails with EMAIL_ALREADY_EXISTS, because
 * Better Auth will not create a second account for the same address.
 *
 * No captcha, for the same reason the member registration form has none: three
 * PDFs and a human review are a better filter than a challenge. The applicant is
 * also already signed in and email-verified, which is stronger evidence still.
 */
export const applyForMembership = createServerFn({ method: 'POST' })
  .inputValidator((formData: FormData) => {
    if (!(formData instanceof FormData)) throw new Error('Invalid payload.')
    const file = (k: string) => {
      const v = formData.get(k)
      return v instanceof File ? v : null
    }
    const plan = String(formData.get('contributionPlan') ?? '').trim()
    if (plan.length < MIN_CONTRIBUTION_PLAN_CHARS) throw new Error('INVALID_PLAN')
    return {
      contributionPlan: plan,
      cv: file('cv'),
      vision: file('vision'),
      contribution: file('contribution'),
    }
  })
  .handler(async ({ data }): Promise<ApplyResult> => {
    const gate = await guard({ action: 'signUp' })
    if (!gate.ok) return { ok: false, code: 'RATE_LIMITED' }

    const { getSession } = await import('./session.server')
    const session = await getSession()
    if (!session?.user) return { ok: false, code: 'NOT_SIGNED_IN' }

    const { checkEligibility, createApplication } = await import('./enrollment')
    const eligibility = await checkEligibility({
      id: session.user.id,
      role: session.user.role,
      emailVerified: session.user.emailVerified,
    })
    if (!eligibility.eligible) return { ok: false, code: eligibility.reason }

    const {
      stageApplicationPdf,
      commitApplicationPdf,
      discardApplicationUploads,
      UploadError,
    } = await import('./uploads')

    // Validate every file before writing anything, exactly as the registration
    // path does: a half-written application is worse than a refused one.
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

    try {
      const [cvPath, visionEssayPath, contributionEssayPath] = await Promise.all(
        staged.map((f) => commitApplicationPdf(session.user.id, f)),
      )
      const { id } = await createApplication({
        userId: session.user.id,
        cvPath,
        visionEssayPath,
        contributionEssayPath,
        contributionPlan: data.contributionPlan,
      })
      return { ok: true, applicationId: id }
    } catch {
      await discardApplicationUploads(session.user.id)
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

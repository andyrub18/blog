import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { memberApplication, OPEN_APPLICATION_STATUSES } from './db/schema'

export type ApplicationEligibility =
  | { eligible: true }
  | {
      eligible: false
      reason: 'ALREADY_MEMBER' | 'APPLICATION_OPEN' | 'EMAIL_UNVERIFIED'
    }

/**
 * Whether a signed-in reader may open a membership application.
 *
 * Three refusals, each for a different reason:
 * - already a member (or above) — there is nothing to apply for;
 * - an application is still open — the partial unique index would reject the
 *   insert anyway, and a clear message beats a constraint violation;
 * - email not verified — we would have no reliable way to tell them the outcome.
 *
 * A *rejected* past application is deliberately not a refusal. People reconsider,
 * circumstances change, and the manifesto's process is about the dossier, not
 * about punishing a first attempt.
 */
export async function checkEligibility(user: {
  id: string
  role: string
  emailVerified: boolean
}): Promise<ApplicationEligibility> {
  if (user.role !== 'reader') return { eligible: false, reason: 'ALREADY_MEMBER' }
  if (!user.emailVerified) return { eligible: false, reason: 'EMAIL_UNVERIFIED' }

  const { db } = await import('./db')
  const open = await db
    .select({ id: memberApplication.id })
    .from(memberApplication)
    .where(
      and(
        eq(memberApplication.userId, user.id),
        inArray(memberApplication.status, [...OPEN_APPLICATION_STATUSES]),
      ),
    )
    .limit(1)

  if (open.length > 0) return { eligible: false, reason: 'APPLICATION_OPEN' }
  return { eligible: true }
}

/**
 * File a membership application for an account that already exists.
 *
 * This is the promotion path: read for a while, take part in the forum, then
 * apply. It is the encouraged route, and it is the same machinery the
 * registration form uses — the only difference is that the account is already
 * there, so nothing already known is asked for again.
 */
export async function createApplication(input: {
  userId: string
  cvPath: string
  visionEssayPath: string
  contributionEssayPath: string
  contributionPlan: string
}): Promise<{ id: string }> {
  const { db } = await import('./db')
  const { applicationEvent } = await import('./db/schema')
  const id = randomUUID()

  await db.transaction(async (tx) => {
    await tx.insert(memberApplication).values({
      id,
      userId: input.userId,
      cvPath: input.cvPath,
      visionEssayPath: input.visionEssayPath,
      contributionEssayPath: input.contributionEssayPath,
      contributionPlan: input.contributionPlan,
      status: 'pending',
    })
    await tx.insert(applicationEvent).values({
      id: randomUUID(),
      applicationId: id,
      fromStatus: null,
      toStatus: 'pending',
      actorId: input.userId,
    })
  })

  return { id }
}

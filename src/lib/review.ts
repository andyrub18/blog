import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm'
import {
  applicationEvent,
  type MemberApplicationStatus,
  memberApplication,
  OPEN_APPLICATION_STATUSES,
  roleChange,
  user,
} from './db/schema'

/** How long the manifesto gives a new member before the circle confirms them. */
export const PROBATION_MONTHS = 6

export type QueueItem = {
  applicationId: string
  applicantId: string
  applicantName: string
  applicantEmail: string
  status: MemberApplicationStatus
  submittedAt: Date
}

export type DecisionKind = 'approve' | 'reject' | 'request_more_info'

export type DecisionError =
  | 'NOT_FOUND'
  | 'ALREADY_DECIDED'
  | 'SELF_REVIEW'
  | 'RATIONALE_REQUIRED'

export type DecisionResult =
  | { ok: true; status: MemberApplicationStatus }
  | { ok: false; code: DecisionError }

const STATUS_FOR: Record<DecisionKind, MemberApplicationStatus> = {
  approve: 'approved',
  reject: 'rejected',
  request_more_info: 'needs_more_info',
}

/** A senior member's written reason must actually say something. */
export const MIN_RATIONALE_CHARS = 20

/** Applications still awaiting a decision, oldest first — a queue, not a stack. */
export async function listQueue(): Promise<Array<QueueItem>> {
  const { db } = await import('./db')
  const rows = await db
    .select({
      applicationId: memberApplication.id,
      applicantId: user.id,
      applicantName: user.name,
      applicantEmail: user.email,
      status: memberApplication.status,
      submittedAt: memberApplication.createdAt,
    })
    .from(memberApplication)
    .innerJoin(user, eq(user.id, memberApplication.userId))
    .where(inArray(memberApplication.status, [...OPEN_APPLICATION_STATUSES]))
    .orderBy(memberApplication.createdAt)

  return rows as Array<QueueItem>
}

export async function getApplication(applicationId: string) {
  const { db } = await import('./db')
  const [row] = await db
    .select({
      id: memberApplication.id,
      userId: memberApplication.userId,
      status: memberApplication.status,
      contributionPlan: memberApplication.contributionPlan,
      decisionRationale: memberApplication.decisionRationale,
      createdAt: memberApplication.createdAt,
      applicantName: user.name,
      applicantEmail: user.email,
      applicantRole: user.role,
    })
    .from(memberApplication)
    .innerJoin(user, eq(user.id, memberApplication.userId))
    .where(eq(memberApplication.id, applicationId))
    .limit(1)
  return row ?? null
}

/** The decision history for one application, newest first. */
export async function getHistory(applicationId: string) {
  const { db } = await import('./db')
  return db
    .select()
    .from(applicationEvent)
    .where(eq(applicationEvent.applicationId, applicationId))
    .orderBy(desc(applicationEvent.createdAt))
}

/** The end of the manifesto's probation, counted from admission. */
export function probationEnd(from: Date): Date {
  const end = new Date(from)
  end.setMonth(end.getMonth() + PROBATION_MONTHS)
  return end
}

/**
 * Record a senior member's decision on an application.
 *
 * Everything happens in one transaction: the application status, the audit
 * event, and — on approval — the applicant's new role and the `role_change`
 * row. A half-applied decision would leave somebody either promoted with no
 * record of who promoted them, or recorded as promoted without the access.
 */
export async function decide(input: {
  applicationId: string
  decision: DecisionKind
  rationale: string
  actorId: string
}): Promise<DecisionResult> {
  const rationale = input.rationale.trim()
  if (rationale.length < MIN_RATIONALE_CHARS) {
    return { ok: false, code: 'RATIONALE_REQUIRED' }
  }

  const { db } = await import('./db')
  const [application] = await db
    .select({
      id: memberApplication.id,
      userId: memberApplication.userId,
      status: memberApplication.status,
    })
    .from(memberApplication)
    .where(eq(memberApplication.id, input.applicationId))
    .limit(1)

  if (!application) return { ok: false, code: 'NOT_FOUND' }

  // Nobody decides their own case. The manifesto assigns admission to a
  // committee precisely so that it is not one person's opinion about themselves.
  if (application.userId === input.actorId) {
    return { ok: false, code: 'SELF_REVIEW' }
  }

  if (!OPEN_APPLICATION_STATUSES.includes(application.status as never)) {
    return { ok: false, code: 'ALREADY_DECIDED' }
  }

  const nextStatus = STATUS_FOR[input.decision]
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx
      .update(memberApplication)
      .set({
        status: nextStatus,
        decisionRationale: rationale,
        reviewedBy: input.actorId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(memberApplication.id, application.id))

    await tx.insert(applicationEvent).values({
      id: randomUUID(),
      applicationId: application.id,
      fromStatus: application.status,
      toStatus: nextStatus,
      rationale,
      actorId: input.actorId,
    })

    if (input.decision === 'approve') {
      const [applicant] = await tx
        .select({ role: user.role })
        .from(user)
        .where(eq(user.id, application.userId))
        .limit(1)

      await tx
        .update(user)
        .set({
          role: 'member',
          memberSince: now,
          probationUntil: probationEnd(now),
          updatedAt: now,
        })
        .where(eq(user.id, application.userId))

      await tx.insert(roleChange).values({
        id: randomUUID(),
        subjectUserId: application.userId,
        fromRole: applicant?.role ?? 'reader',
        toRole: 'member',
        reason: 'application_approved',
        rationale,
        actorId: input.actorId,
      })
    }
  })

  return { ok: true, status: nextStatus }
}

/**
 * Members whose probation has elapsed and who now need a confirmation decision.
 *
 * The contribution plan comes with them. The manifesto's probation asks whether
 * the member kept the commitments they made on admission, so a queue that shows
 * only names would invite a rubber stamp — the reviewer would have nothing to
 * check against.
 */
export async function listProbationDue(now: Date = new Date()) {
  const { db } = await import('./db')
  return db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      memberSince: user.memberSince,
      probationUntil: user.probationUntil,
      applicationId: memberApplication.id,
      contributionPlan: memberApplication.contributionPlan,
    })
    .from(user)
    .leftJoin(
      memberApplication,
      and(
        eq(memberApplication.userId, user.id),
        eq(memberApplication.status, 'approved'),
      ),
    )
    .where(
      and(
        eq(user.role, 'member'),
        isNull(user.probationConfirmedAt),
        lte(user.probationUntil, now),
      ),
    )
    .orderBy(user.probationUntil)
}

export type ProbationCase = Awaited<ReturnType<typeof listProbationDue>>[number]

export type ProbationDecisionKind = 'confirm' | 'revert'

export type ProbationError =
  | 'NOT_FOUND'
  | 'NOT_IN_PROBATION'
  | 'TOO_EARLY'
  | 'SELF_REVIEW'
  | 'RATIONALE_REQUIRED'

export type ProbationResult =
  | { ok: true; decision: ProbationDecisionKind }
  | { ok: false; code: ProbationError }

/**
 * Close a member's probation: confirm them, or send them back to reader.
 *
 * The manifesto admits a member for a probation period and has the circle
 * evaluate them at the end of it. Both outcomes are recorded the same way, in
 * one transaction with a written reason — being sent back is the decision most
 * worth being able to account for later.
 */
export async function confirmProbation(input: {
  userId: string
  decision: ProbationDecisionKind
  rationale: string
  actorId: string
  now?: Date
}): Promise<ProbationResult> {
  const rationale = input.rationale.trim()
  if (rationale.length < MIN_RATIONALE_CHARS) {
    return { ok: false, code: 'RATIONALE_REQUIRED' }
  }

  // Nobody closes their own probation, for the same reason nobody reviews their
  // own application.
  if (input.userId === input.actorId) {
    return { ok: false, code: 'SELF_REVIEW' }
  }

  const { db } = await import('./db')
  const [subject] = await db
    .select({
      id: user.id,
      role: user.role,
      probationUntil: user.probationUntil,
      probationConfirmedAt: user.probationConfirmedAt,
    })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1)

  if (!subject) return { ok: false, code: 'NOT_FOUND' }

  if (
    subject.role !== 'member' ||
    !subject.probationUntil ||
    subject.probationConfirmedAt
  ) {
    return { ok: false, code: 'NOT_IN_PROBATION' }
  }

  const now = input.now ?? new Date()

  // The six months are the rule, not a target. A reviewer who could close a
  // probation early could admit someone outright in a single click, which is
  // exactly what the probation period exists to prevent.
  if (subject.probationUntil > now) {
    return { ok: false, code: 'TOO_EARLY' }
  }

  await db.transaction(async (tx) => {
    if (input.decision === 'confirm') {
      await tx
        .update(user)
        .set({ probationConfirmedAt: now, updatedAt: now })
        .where(eq(user.id, subject.id))
    } else {
      // Back to reader. `memberSince` and `probationUntil` are cleared because
      // they describe a current membership that has ended; the `role_change`
      // row below is what preserves the history.
      await tx
        .update(user)
        .set({
          role: 'reader',
          memberSince: null,
          probationUntil: null,
          updatedAt: now,
        })
        .where(eq(user.id, subject.id))
    }

    await tx.insert(roleChange).values({
      id: randomUUID(),
      subjectUserId: subject.id,
      fromRole: 'member',
      toRole: input.decision === 'confirm' ? 'member' : 'reader',
      reason: input.decision === 'confirm' ? 'probation_confirmed' : 'probation_reverted',
      rationale,
      actorId: input.actorId,
    })
  })

  return { ok: true, decision: input.decision }
}

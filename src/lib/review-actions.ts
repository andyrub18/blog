import { createServerFn } from '@tanstack/solid-start'
import type {
  DecisionKind,
  ProbationCase,
  ProbationDecisionKind,
  QueueItem,
} from './review'

export type ReviewErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ALREADY_DECIDED'
  | 'SELF_REVIEW'
  | 'RATIONALE_REQUIRED'
  | 'NOT_IN_PROBATION'
  | 'TOO_EARLY'
  | 'UNEXPECTED'

export type DecideResult =
  | { ok: true; status: string }
  | { ok: false; code: ReviewErrorCode }

/**
 * Every function here re-checks the caller's role on the server.
 *
 * A route guard is UX: a `createServerFn` is a public HTTP endpoint that anyone
 * can call directly, so the guard in the route tells us nothing about who is on
 * the other end of this request. These endpoints expose the membership roster
 * and people's CVs, which makes them the ones most worth calling directly.
 */
async function requireReviewer() {
  const { requireRole } = await import('./session.server')
  return requireRole(['senior_member', 'super_admin'])
}

export const fetchReviewQueue = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<QueueItem>> => {
    await requireReviewer()
    const { listQueue } = await import('./review')
    return listQueue()
  },
)

export const fetchApplication = createServerFn({ method: 'GET' })
  .inputValidator((data: { applicationId: string }) => {
    if (!data?.applicationId) throw new Error('applicationId is required')
    return { applicationId: data.applicationId }
  })
  .handler(async ({ data }) => {
    const reviewer = await requireReviewer()
    const { getApplication, getHistory } = await import('./review')
    const application = await getApplication(data.applicationId)
    if (!application) return null

    // Opening a dossier is itself an access worth recording, not only the file
    // download: it is when the reviewer sees the applicant's name and essay.
    const [{ db }, { accessEvent }, { randomUUID }] = await Promise.all([
      import('./db'),
      import('./db/schema'),
      import('node:crypto'),
    ])
    await db.insert(accessEvent).values({
      id: randomUUID(),
      actorId: reviewer.id,
      resourceType: 'member_application',
      resourceId: data.applicationId,
      action: 'view',
    })

    return { application, history: await getHistory(data.applicationId) }
  })

export const decideApplication = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { applicationId: string; decision: DecisionKind; rationale: string }) => {
      if (!data?.applicationId) throw new Error('applicationId is required')
      if (!['approve', 'reject', 'request_more_info'].includes(data.decision)) {
        throw new Error('Unknown decision')
      }
      return {
        applicationId: data.applicationId,
        decision: data.decision,
        rationale: String(data.rationale ?? ''),
      }
    },
  )
  .handler(async ({ data }): Promise<DecideResult> => {
    const reviewer = await requireReviewer()
    const { decide } = await import('./review')
    try {
      const result = await decide({
        applicationId: data.applicationId,
        decision: data.decision,
        rationale: data.rationale,
        actorId: reviewer.id,
      })
      if (!result.ok) return { ok: false, code: result.code }
      return { ok: true, status: result.status }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

export const fetchProbationDue = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<ProbationCase>> => {
    const reviewer = await requireReviewer()
    const { listProbationDue } = await import('./review')
    const due = await listProbationDue()

    // Reading a member's contribution plan is a privileged read of their
    // dossier, and the access log is only honest if it records the list view
    // too — not just the ones the reviewer clicked into.
    const seen = due.filter((item) => item.applicationId)
    if (seen.length > 0) {
      const [{ db }, { accessEvent }, { randomUUID }] = await Promise.all([
        import('./db'),
        import('./db/schema'),
        import('node:crypto'),
      ])
      await db.insert(accessEvent).values(
        seen.map((item) => ({
          id: randomUUID(),
          actorId: reviewer.id,
          resourceType: 'member_application',
          resourceId: item.applicationId as string,
          action: 'view' as const,
        })),
      )
    }

    return due
  },
)

export const decideProbation = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { userId: string; decision: ProbationDecisionKind; rationale: string }) => {
      if (!data?.userId) throw new Error('userId is required')
      if (!['confirm', 'revert'].includes(data.decision)) {
        throw new Error('Unknown decision')
      }
      return {
        userId: data.userId,
        decision: data.decision,
        rationale: String(data.rationale ?? ''),
      }
    },
  )
  .handler(async ({ data }): Promise<DecideResult> => {
    const reviewer = await requireReviewer()
    const { confirmProbation } = await import('./review')
    try {
      const result = await confirmProbation({
        userId: data.userId,
        decision: data.decision,
        rationale: data.rationale,
        actorId: reviewer.id,
      })
      if (!result.ok) return { ok: false, code: result.code }
      return { ok: true, status: result.decision }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

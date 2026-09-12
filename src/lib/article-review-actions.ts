import { createServerFn } from '@tanstack/solid-start'
import type {
  Documentation,
  LanguageResult,
  ReviewError,
  SubmissionCard,
} from './article-review'
import type { Viewer } from './articles'
import type { ReviewerStance, ReviewVerdict } from './db/schema'

/**
 * The deliberation endpoints.
 *
 * Every handler re-checks the caller. These are the endpoints that decide what
 * the movement publishes under its own name, so they are exactly the ones worth
 * calling directly: the role checks live in `article-review.ts` next to the
 * rules they enforce, and are reached through the `Viewer` these functions build
 * from the session rather than from anything the caller sends.
 */

export type ReviewErrorCode = ReviewError | 'UNEXPECTED'

export type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ReviewErrorCode }

async function currentActor(): Promise<Viewer> {
  const { requireUser } = await import('./session.server')
  const user = await requireUser()
  return { id: user.id, role: user.role, memberStatus: user.memberStatus }
}

/** A senior member, checked here as well as in the rule below it. */
async function requireSenior(): Promise<Viewer> {
  const { requireRole } = await import('./session.server')
  const user = await requireRole(['senior_member', 'super_admin'])
  return { id: user.id, role: user.role, memberStatus: user.memberStatus }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export const submitArticleForReview = createServerFn({ method: 'POST' })
  .validator(
    (data: { articleId: string; langs: Array<string>; documentation: Documentation }) => {
      if (!data?.articleId) throw new Error('articleId is required')
      return {
        articleId: String(data.articleId),
        langs: Array.isArray(data.langs) ? data.langs.map(String) : [],
        documentation: {
          diagnosis: text(data.documentation?.diagnosis),
          solutions: text(data.documentation?.solutions),
          resources: text(data.documentation?.resources),
          risks: text(data.documentation?.risks),
          indicators: text(data.documentation?.indicators),
        },
      }
    },
  )
  .handler(
    async ({ data }): Promise<ActionResult<{ submissionId: string; round: number }>> => {
      const actor = await currentActor()
      const { submitForReview } = await import('./article-review')
      try {
        const result = await submitForReview({ actor, ...data })
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, code: result.code }
      } catch {
        return { ok: false, code: 'UNEXPECTED' }
      }
    },
  )

export const fetchSubmissionQueue = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<SubmissionCard>> => {
    await requireSenior()
    const { listSubmissionQueue } = await import('./article-review')
    return listSubmissionQueue()
  },
)

/**
 * One submission in full.
 *
 * Open to any member, not just senior members: an assigned reviewer has to read
 * the documentation and the verdicts to do the job they were named for, and
 * the panel's arguments are meant to be seen by the people arguing.
 */
export const fetchSubmission = createServerFn({ method: 'GET' })
  .validator((data: { submissionId: string }) => {
    if (!data?.submissionId) throw new Error('submissionId is required')
    return { submissionId: String(data.submissionId) }
  })
  .handler(async ({ data }) => {
    const actor = await currentActor()
    const { hasAtLeastRole } = await import('./db/schema')
    if (!hasAtLeastRole(actor.role, 'member')) return null
    const { getSubmission } = await import('./article-review')
    return getSubmission(data.submissionId)
  })

/** Who a senior member can put on a panel: members and above, the author aside. */
export const fetchAssignableMembers = createServerFn({ method: 'GET' })
  .validator((data: { submissionId: string }) => ({
    submissionId: String(data?.submissionId ?? ''),
  }))
  .handler(async ({ data }) => {
    await requireSenior()
    const [{ db }, schema, { and, eq, inArray, ne }] = await Promise.all([
      import('./db'),
      import('./db/schema'),
      import('drizzle-orm'),
    ])

    const [submission] = await db
      .select({ authorId: schema.article.authorId })
      .from(schema.articleSubmission)
      .innerJoin(
        schema.article,
        eq(schema.article.id, schema.articleSubmission.articleId),
      )
      .where(eq(schema.articleSubmission.id, data.submissionId))
      .limit(1)

    if (!submission) return []

    return db
      .select({ id: schema.user.id, name: schema.user.name, role: schema.user.role })
      .from(schema.user)
      .where(
        and(
          inArray(schema.user.role, ['member', 'senior_member', 'super_admin']),
          eq(schema.user.memberStatus, 'active'),
          ne(schema.user.id, submission.authorId),
        ),
      )
      .orderBy(schema.user.name)
  })

export const assignReviewerAction = createServerFn({ method: 'POST' })
  .validator((data: { submissionId: string; userId: string; stance: ReviewerStance }) => {
    if (!data?.submissionId || !data?.userId) throw new Error('missing identifiers')
    if (data.stance !== 'contradictor' && data.stance !== 'reviewer') {
      throw new Error('Unknown stance')
    }
    return {
      submissionId: String(data.submissionId),
      userId: String(data.userId),
      stance: data.stance,
    }
  })
  .handler(async ({ data }): Promise<ActionResult<{ assigned: string }>> => {
    const actor = await requireSenior()
    const { assignReviewer } = await import('./article-review')
    try {
      const result = await assignReviewer({ actor, ...data })
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, code: result.code }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

export const unassignReviewerAction = createServerFn({ method: 'POST' })
  .validator((data: { submissionId: string; userId: string }) => {
    if (!data?.submissionId || !data?.userId) throw new Error('missing identifiers')
    return { submissionId: String(data.submissionId), userId: String(data.userId) }
  })
  .handler(async ({ data }): Promise<ActionResult<{ removed: string }>> => {
    const actor = await requireSenior()
    const { unassignReviewer } = await import('./article-review')
    try {
      const result = await unassignReviewer({ actor, ...data })
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, code: result.code }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

export const openDeliberationAction = createServerFn({ method: 'POST' })
  .validator((data: { submissionId: string }) => {
    if (!data?.submissionId) throw new Error('submissionId is required')
    return { submissionId: String(data.submissionId) }
  })
  .handler(async ({ data }): Promise<ActionResult<{ status: string }>> => {
    const actor = await requireSenior()
    const { openDeliberation } = await import('./article-review')
    try {
      const result = await openDeliberation({ actor, ...data })
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, code: result.code }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

export const recordVerdictAction = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      submissionId: string
      lang: string
      verdict: ReviewVerdict
      rationale: string
    }) => {
      if (!data?.submissionId) throw new Error('submissionId is required')
      if (!['support', 'object', 'abstain'].includes(data.verdict)) {
        throw new Error('Unknown verdict')
      }
      return {
        submissionId: String(data.submissionId),
        lang: String(data.lang ?? ''),
        verdict: data.verdict,
        rationale: text(data.rationale),
      }
    },
  )
  .handler(async ({ data }): Promise<ActionResult<{ verdict: string }>> => {
    // Any member may be assigned; `recordVerdict` is what checks that this one
    // actually was, which is the check that matters.
    const actor = await currentActor()
    const { recordVerdict } = await import('./article-review')
    try {
      const result = await recordVerdict({ actor, ...data })
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, code: result.code }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

export const decideSubmissionAction = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      submissionId: string
      rationale: string
      unresolved?: 'revision_requested' | 'rejected'
    }) => {
      if (!data?.submissionId) throw new Error('submissionId is required')
      return {
        submissionId: String(data.submissionId),
        rationale: text(data.rationale),
        unresolved:
          data.unresolved === 'rejected'
            ? ('rejected' as const)
            : ('revision_requested' as const),
      }
    },
  )
  .handler(
    async ({
      data,
    }): Promise<ActionResult<{ outcome: string; languages: Array<LanguageResult> }>> => {
      const actor = await requireSenior()
      const { decide } = await import('./article-review')
      try {
        const result = await decide({ actor, ...data })
        return result.ok
          ? {
              ok: true,
              value: { outcome: result.value.outcome, languages: result.value.languages },
            }
          : { ok: false, code: result.code }
      } catch {
        return { ok: false, code: 'UNEXPECTED' }
      }
    },
  )

export const withdrawSubmissionAction = createServerFn({ method: 'POST' })
  .validator((data: { submissionId: string }) => {
    if (!data?.submissionId) throw new Error('submissionId is required')
    return { submissionId: String(data.submissionId) }
  })
  .handler(async ({ data }): Promise<ActionResult<{ withdrawn: string }>> => {
    const actor = await currentActor()
    const { withdrawSubmission } = await import('./article-review')
    try {
      const result = await withdrawSubmission({ actor, ...data })
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, code: result.code }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

/** Every round an article has been through, for the author's own desk. */
export const fetchRounds = createServerFn({ method: 'GET' })
  .validator((data: { articleId: string }) => ({
    articleId: String(data?.articleId ?? ''),
  }))
  .handler(async ({ data }) => {
    const actor = await currentActor()
    const [{ db }, schema, { eq }] = await Promise.all([
      import('./db'),
      import('./db/schema'),
      import('drizzle-orm'),
    ])
    const [row] = await db
      .select({ authorId: schema.article.authorId })
      .from(schema.article)
      .where(eq(schema.article.id, data.articleId))
      .limit(1)

    const { canEdit } = await import('./articles')
    if (!row || !canEdit(actor, row.authorId)) return []

    const { listRounds } = await import('./article-review')
    return listRounds(data.articleId)
  })

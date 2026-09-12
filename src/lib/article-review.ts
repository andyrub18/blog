import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Viewer } from './articles'
import {
  type ArticleStatus,
  article,
  articleDecision,
  articleReview,
  articleReviewer,
  articleSubmission,
  articleTranslation,
  type DecisionMethod,
  type DecisionOutcome,
  hasAtLeastRole,
  type ReviewerStance,
  type ReviewVerdict,
  type SubmissionStatus,
  user,
} from './db/schema'
import {
  type Documentation,
  evaluateLanguage,
  type LanguageOutcome,
  type LanguageTally,
  MIN_RATIONALE_CHARS,
  meetsQuorum,
  trimDocumentation,
} from './deliberation'

/**
 * The manifesto's deliberation, as code.
 *
 * A documented submission, named members assigned to argue against it, verdicts
 * with written reasons, and an outcome the arithmetic decides rather than
 * whoever happens to be chairing. A binary approve/reject button would make this
 * Medium with extra steps; building *this* is the reason KLE needs its own
 * platform.
 *
 * The arithmetic at the top is pure and tested on its own, the same way
 * `promotion.ts` keeps `evaluate()` separate. It is the rule the whole flow
 * exists to enforce and the easiest part to get quietly wrong.
 */

export {
  type AssignedReviewer,
  type Documentation,
  evaluateLanguage,
  type LanguageOutcome,
  type LanguageTally,
  MIN_DOCUMENTATION_CHARS,
  MIN_LANGUAGE_SUPPORT,
  MIN_RATIONALE_CHARS,
  MIN_REVIEWERS,
  meetsQuorum,
} from './deliberation'

export type ReviewError =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_AUTHOR'
  | 'NO_LANGUAGES'
  | 'LANGUAGE_EMPTY'
  | 'DOCUMENTATION_REQUIRED'
  | 'RATIONALE_REQUIRED'
  | 'ALREADY_SUBMITTED'
  | 'WRONG_STATE'
  | 'NO_QUORUM'
  | 'SELF_REVIEW'
  | 'NOT_ASSIGNED'
  | 'ALREADY_VOTED'
  | 'LANGUAGE_NOT_IN_SUBMISSION'
  | 'REVIEWERS_STILL_SILENT'

export type ReviewResult<T> = { ok: true; value: T } | { ok: false; code: ReviewError }

function isSenior(viewer: Viewer): boolean {
  return viewer.memberStatus !== 'blocked' && hasAtLeastRole(viewer.role, 'senior_member')
}

/**
 * Put an article to the circle.
 *
 * The author does this, and only for languages that actually have text in them:
 * submitting an empty Creole would put reviewers in front of a blank page and
 * make the round meaningless. Revisions come back as a new round rather than
 * overwriting this one, so the argument history survives — which is the whole
 * point of keeping rounds at all.
 */
export async function submitForReview(input: {
  actor: Viewer
  articleId: string
  langs: Array<string>
  documentation: Documentation
}): Promise<ReviewResult<{ submissionId: string; round: number }>> {
  const documentation = trimDocumentation(input.documentation)
  if (!documentation) return { ok: false, code: 'DOCUMENTATION_REQUIRED' }

  const langs = [...new Set(input.langs)].sort()
  if (langs.length === 0) return { ok: false, code: 'NO_LANGUAGES' }

  const { db } = await import('./db')
  const [row] = await db
    .select({ id: article.id, authorId: article.authorId, status: article.status })
    .from(article)
    .where(eq(article.id, input.articleId))
    .limit(1)

  if (!row) return { ok: false, code: 'NOT_FOUND' }
  // Only the author submits. A senior member may edit a draft, but putting
  // somebody's name to a proposal they have not finished is theirs alone.
  if (row.authorId !== input.actor.id) return { ok: false, code: 'NOT_AUTHOR' }
  if (input.actor.memberStatus === 'blocked') return { ok: false, code: 'FORBIDDEN' }

  const { parseDocument } = await import('./prosemirror')
  const translations = await db
    .select({
      lang: articleTranslation.lang,
      contentJson: articleTranslation.contentJson,
    })
    .from(articleTranslation)
    .where(
      and(
        eq(articleTranslation.articleId, row.id),
        inArray(articleTranslation.lang, langs),
      ),
    )

  if (translations.length !== langs.length) return { ok: false, code: 'LANGUAGE_EMPTY' }
  for (const translation of translations) {
    if (!parseDocument(translation.contentJson).ok) {
      return { ok: false, code: 'LANGUAGE_EMPTY' }
    }
  }

  const [previous] = await db
    .select({ round: articleSubmission.round })
    .from(articleSubmission)
    .where(eq(articleSubmission.articleId, row.id))
    .orderBy(desc(articleSubmission.round))
    .limit(1)

  const id = randomUUID()
  const round = (previous?.round ?? 0) + 1

  try {
    await db.transaction(async (tx) => {
      await tx.insert(articleSubmission).values({
        id,
        articleId: row.id,
        round,
        langs,
        submittedBy: input.actor.id,
        status: 'open',
        ...documentation,
      })
      await tx
        .update(article)
        .set({ status: 'submitted', updatedAt: new Date() })
        .where(eq(article.id, row.id))
    })
  } catch {
    // The partial unique index is what actually decides, so a second submission
    // opened in the same moment gets the same answer as one opened a beat later.
    return { ok: false, code: 'ALREADY_SUBMITTED' }
  }

  return { ok: true, value: { submissionId: id, round } }
}

/**
 * Name somebody to the panel.
 *
 * A senior member does the naming, never the reviewer themselves. A volunteer
 * contradictor is either an ally or an opponent, and either way the circle chose
 * neither of them — which is the objection the manifesto's own wording answers
 * by making the assignment explicit.
 */
export async function assignReviewer(input: {
  actor: Viewer
  submissionId: string
  userId: string
  stance: ReviewerStance
}): Promise<ReviewResult<{ assigned: string }>> {
  if (!isSenior(input.actor)) return { ok: false, code: 'FORBIDDEN' }

  const { db } = await import('./db')
  const [submission] = await db
    .select({
      id: articleSubmission.id,
      status: articleSubmission.status,
      authorId: article.authorId,
    })
    .from(articleSubmission)
    .innerJoin(article, eq(article.id, articleSubmission.articleId))
    .where(eq(articleSubmission.id, input.submissionId))
    .limit(1)

  if (!submission) return { ok: false, code: 'NOT_FOUND' }
  if (submission.status !== 'open' && submission.status !== 'in_review') {
    return { ok: false, code: 'WRONG_STATE' }
  }
  // Nobody reviews their own proposal, which is the rule the whole committee
  // structure exists to express.
  if (submission.authorId === input.userId) return { ok: false, code: 'SELF_REVIEW' }

  const [candidate] = await db
    .select({ id: user.id, role: user.role, memberStatus: user.memberStatus })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1)

  if (!candidate) return { ok: false, code: 'NOT_FOUND' }
  // Members review when assigned; a reader has not been admitted to the
  // deliberation at all.
  if (candidate.memberStatus !== 'active' || !hasAtLeastRole(candidate.role, 'member')) {
    return { ok: false, code: 'FORBIDDEN' }
  }

  await db
    .insert(articleReviewer)
    .values({
      submissionId: submission.id,
      userId: input.userId,
      stance: input.stance,
      assignedBy: input.actor.id,
    })
    .onConflictDoUpdate({
      target: [articleReviewer.submissionId, articleReviewer.userId],
      // Re-assigning changes the stance rather than failing: a senior member
      // correcting "reviewer" to "contradictor" is a normal thing to do.
      set: { stance: input.stance, assignedBy: input.actor.id },
    })

  return { ok: true, value: { assigned: input.userId } }
}

/**
 * Take somebody off the panel.
 *
 * Needed because a decision waits for every assigned reviewer to speak. Without
 * this, one member who stops answering their email would freeze a proposal
 * indefinitely, and the way out would be to relax the rule for everybody.
 * Verdicts they already recorded go with them; a verdict from somebody no
 * longer on the panel would count toward a tally they are not part of.
 */
export async function unassignReviewer(input: {
  actor: Viewer
  submissionId: string
  userId: string
}): Promise<ReviewResult<{ removed: string }>> {
  if (!isSenior(input.actor)) return { ok: false, code: 'FORBIDDEN' }

  const { db } = await import('./db')
  const [submission] = await db
    .select({ id: articleSubmission.id, status: articleSubmission.status })
    .from(articleSubmission)
    .where(eq(articleSubmission.id, input.submissionId))
    .limit(1)

  if (!submission) return { ok: false, code: 'NOT_FOUND' }
  if (submission.status !== 'open' && submission.status !== 'in_review') {
    return { ok: false, code: 'WRONG_STATE' }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(articleReview)
      .where(
        and(
          eq(articleReview.submissionId, submission.id),
          eq(articleReview.reviewerId, input.userId),
        ),
      )
    await tx
      .delete(articleReviewer)
      .where(
        and(
          eq(articleReviewer.submissionId, submission.id),
          eq(articleReviewer.userId, input.userId),
        ),
      )
  })

  return { ok: true, value: { removed: input.userId } }
}

/** The panel as it stands. */
export async function listReviewers(submissionId: string) {
  const { db } = await import('./db')
  return db
    .select({
      userId: articleReviewer.userId,
      stance: articleReviewer.stance,
      assignedAt: articleReviewer.assignedAt,
      name: user.name,
      email: user.email,
    })
    .from(articleReviewer)
    .innerJoin(user, eq(user.id, articleReviewer.userId))
    .where(eq(articleReviewer.submissionId, submissionId))
    .orderBy(articleReviewer.assignedAt)
}

/**
 * Open the debate.
 *
 * The quorum is checked here rather than at the decision, so a panel that is
 * too small is a problem somebody fixes before anyone spends an evening reading
 * the article — not after.
 */
export async function openDeliberation(input: {
  actor: Viewer
  submissionId: string
}): Promise<ReviewResult<{ status: SubmissionStatus }>> {
  if (!isSenior(input.actor)) return { ok: false, code: 'FORBIDDEN' }

  const { db } = await import('./db')
  const [submission] = await db
    .select({
      id: articleSubmission.id,
      articleId: articleSubmission.articleId,
      status: articleSubmission.status,
    })
    .from(articleSubmission)
    .where(eq(articleSubmission.id, input.submissionId))
    .limit(1)

  if (!submission) return { ok: false, code: 'NOT_FOUND' }
  if (submission.status !== 'open') return { ok: false, code: 'WRONG_STATE' }

  const panel = await db
    .select({ userId: articleReviewer.userId, stance: articleReviewer.stance })
    .from(articleReviewer)
    .where(eq(articleReviewer.submissionId, submission.id))

  if (!meetsQuorum(panel)) return { ok: false, code: 'NO_QUORUM' }

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(articleSubmission)
      .set({ status: 'in_review' })
      .where(eq(articleSubmission.id, submission.id))
    await tx
      .update(article)
      .set({ status: 'in_review', updatedAt: now })
      .where(eq(article.id, submission.articleId))
  })

  return { ok: true, value: { status: 'in_review' } }
}

/**
 * Record one reviewer's verdict on one language.
 *
 * The rationale is required and the column is `NOT NULL`, because a verdict
 * without reasoning is a popularity vote — which is the thing this whole
 * process is built to refuse.
 */
export async function recordVerdict(input: {
  actor: Viewer
  submissionId: string
  lang: string
  verdict: ReviewVerdict
  rationale: string
}): Promise<ReviewResult<{ verdict: ReviewVerdict }>> {
  const rationale = input.rationale.trim()
  if (rationale.length < MIN_RATIONALE_CHARS) {
    return { ok: false, code: 'RATIONALE_REQUIRED' }
  }

  const { db } = await import('./db')
  const [submission] = await db
    .select({
      id: articleSubmission.id,
      status: articleSubmission.status,
      langs: articleSubmission.langs,
      authorId: article.authorId,
    })
    .from(articleSubmission)
    .innerJoin(article, eq(article.id, articleSubmission.articleId))
    .where(eq(articleSubmission.id, input.submissionId))
    .limit(1)

  if (!submission) return { ok: false, code: 'NOT_FOUND' }
  if (submission.status !== 'in_review') return { ok: false, code: 'WRONG_STATE' }
  if (submission.authorId === input.actor.id) return { ok: false, code: 'SELF_REVIEW' }
  if (!submission.langs.includes(input.lang)) {
    return { ok: false, code: 'LANGUAGE_NOT_IN_SUBMISSION' }
  }

  const [assigned] = await db
    .select({ stance: articleReviewer.stance })
    .from(articleReviewer)
    .where(
      and(
        eq(articleReviewer.submissionId, submission.id),
        eq(articleReviewer.userId, input.actor.id),
      ),
    )
    .limit(1)

  if (!assigned) return { ok: false, code: 'NOT_ASSIGNED' }

  try {
    await db.insert(articleReview).values({
      id: randomUUID(),
      submissionId: submission.id,
      reviewerId: input.actor.id,
      lang: input.lang,
      verdict: input.verdict,
      rationale,
    })
  } catch {
    // The unique index decides. A reviewer may change their mind in the
    // discussion, not by quietly filing a second verdict.
    return { ok: false, code: 'ALREADY_VOTED' }
  }

  return { ok: true, value: { verdict: input.verdict } }
}

export type LanguageResult = LanguageTally & LanguageOutcome & { lang: string }

/** The tallies as they stand, per language — what the panel can see while it works. */
export async function tallySubmission(
  submissionId: string,
): Promise<Array<LanguageResult>> {
  const { db } = await import('./db')
  const [submission] = await db
    .select({ langs: articleSubmission.langs })
    .from(articleSubmission)
    .where(eq(articleSubmission.id, submissionId))
    .limit(1)
  if (!submission) return []

  const verdicts = await db
    .select({
      lang: articleReview.lang,
      verdict: articleReview.verdict,
      reviewerId: articleReview.reviewerId,
      stance: articleReviewer.stance,
    })
    .from(articleReview)
    .innerJoin(
      articleReviewer,
      and(
        eq(articleReviewer.submissionId, articleReview.submissionId),
        eq(articleReviewer.userId, articleReview.reviewerId),
      ),
    )
    .where(eq(articleReview.submissionId, submissionId))

  return submission.langs.map((lang) => {
    const forLang = verdicts.filter((v) => v.lang === lang)
    const tally: LanguageTally = {
      supports: forLang.filter((v) => v.verdict === 'support').length,
      objections: forLang.filter((v) => v.verdict === 'object').length,
      abstentions: forLang.filter((v) => v.verdict === 'abstain').length,
      contradicted: forLang.some((v) => v.stance === 'contradictor'),
    }
    return { lang, ...tally, ...evaluateLanguage(tally) }
  })
}

/**
 * Close the submission and record what the circle decided.
 *
 * The senior member records the decision; they do not make it. Which languages
 * are accepted comes out of `evaluateLanguage`, and no argument in the
 * rationale can change it — the one judgement left to a person is what happens
 * to the languages that did *not* pass, because "come back with another round"
 * and "the circle will not take this further" are genuinely different answers
 * and arithmetic cannot tell them apart.
 *
 * A decision may only be taken once every assigned reviewer has spoken on at
 * least one language. Otherwise the moment of the decision would itself be a
 * lever: whoever closed it could pick the tally they liked.
 */
export async function decide(input: {
  actor: Viewer
  submissionId: string
  rationale: string
  unresolved?: 'revision_requested' | 'rejected'
}): Promise<
  ReviewResult<{
    outcome: DecisionOutcome
    method: DecisionMethod
    languages: Array<LanguageResult>
  }>
> {
  if (!isSenior(input.actor)) return { ok: false, code: 'FORBIDDEN' }
  const rationale = input.rationale.trim()
  if (rationale.length < MIN_RATIONALE_CHARS) {
    return { ok: false, code: 'RATIONALE_REQUIRED' }
  }

  const { db } = await import('./db')
  const [submission] = await db
    .select({
      id: articleSubmission.id,
      articleId: articleSubmission.articleId,
      status: articleSubmission.status,
      langs: articleSubmission.langs,
      authorId: article.authorId,
      articlePublishedAt: article.publishedAt,
    })
    .from(articleSubmission)
    .innerJoin(article, eq(article.id, articleSubmission.articleId))
    .where(eq(articleSubmission.id, input.submissionId))
    .limit(1)

  if (!submission) return { ok: false, code: 'NOT_FOUND' }
  if (submission.status !== 'in_review') return { ok: false, code: 'WRONG_STATE' }
  if (submission.authorId === input.actor.id) return { ok: false, code: 'SELF_REVIEW' }

  const panel = await db
    .select({ userId: articleReviewer.userId })
    .from(articleReviewer)
    .where(eq(articleReviewer.submissionId, submission.id))

  const spoken = await db
    .select({ reviewerId: articleReview.reviewerId })
    .from(articleReview)
    .where(eq(articleReview.submissionId, submission.id))

  const silent = panel.filter((r) => !spoken.some((s) => s.reviewerId === r.userId))
  if (silent.length > 0) return { ok: false, code: 'REVIEWERS_STILL_SILENT' }

  const languages = await tallySubmission(submission.id)
  const accepted = languages.filter((l) => l.accepted)
  const outcome: DecisionOutcome =
    accepted.length > 0 ? 'accepted' : (input.unresolved ?? 'revision_requested')
  // Consensus only if every language that passed did so unopposed.
  const method: DecisionMethod = accepted.every((l) => l.method === 'consensus')
    ? 'consensus'
    : 'qualified_majority'

  /**
   * What the decision means for the article itself.
   *
   * A rejected proposal is `archived`, not `draft`. `draft` would put it back on
   * the author's desk as though nothing had happened and invite them to submit
   * the same text again; archiving says the circle has answered. The round and
   * its tally stay on file either way, and an archived article can still be
   * revised and resubmitted — the history is what stops that being a fresh start.
   */
  const ARTICLE_STATUS_FOR: Record<DecisionOutcome, ArticleStatus> = {
    accepted: 'published',
    revision_requested: 'revision_requested',
    rejected: 'archived',
  }

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(articleSubmission)
      .set({ status: 'decided' })
      .where(eq(articleSubmission.id, submission.id))

    await tx.insert(articleDecision).values({
      id: randomUUID(),
      submissionId: submission.id,
      outcome,
      method,
      // The per-language tallies, kept with the decision. A bare outcome would
      // be unauditable the moment anybody disputed it.
      tallyJson: { rationale, languages },
      decidedBy: input.actor.id,
    })

    for (const language of accepted) {
      await tx
        .update(articleTranslation)
        .set({ status: 'published', publishedAt: now, updatedAt: now })
        .where(
          and(
            eq(articleTranslation.articleId, submission.articleId),
            eq(articleTranslation.lang, language.lang),
          ),
        )
    }

    await tx
      .update(article)
      .set({
        status: ARTICLE_STATUS_FOR[outcome],
        // First publication only: a second accepted language does not restate
        // when the article reached anyone.
        publishedAt:
          outcome === 'accepted' ? (submission.articlePublishedAt ?? now) : undefined,
        updatedAt: now,
      })
      .where(eq(article.id, submission.articleId))
  })

  return { ok: true, value: { outcome, method, languages } }
}

/** Take a submission back, before the circle has spent time on it. */
export async function withdrawSubmission(input: {
  actor: Viewer
  submissionId: string
}): Promise<ReviewResult<{ withdrawn: string }>> {
  const { db } = await import('./db')
  const [submission] = await db
    .select({
      id: articleSubmission.id,
      articleId: articleSubmission.articleId,
      status: articleSubmission.status,
      authorId: article.authorId,
    })
    .from(articleSubmission)
    .innerJoin(article, eq(article.id, articleSubmission.articleId))
    .where(eq(articleSubmission.id, input.submissionId))
    .limit(1)

  if (!submission) return { ok: false, code: 'NOT_FOUND' }
  if (submission.authorId !== input.actor.id && !isSenior(input.actor)) {
    return { ok: false, code: 'FORBIDDEN' }
  }
  if (submission.status === 'decided') return { ok: false, code: 'WRONG_STATE' }

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(articleSubmission)
      .set({ status: 'withdrawn' })
      .where(eq(articleSubmission.id, submission.id))
    // Back to a draft. The round stays on file: a withdrawn proposal is part of
    // the argument history too.
    await tx
      .update(article)
      .set({ status: 'draft', updatedAt: now })
      .where(eq(article.id, submission.articleId))
  })

  return { ok: true, value: { withdrawn: submission.id } }
}

export type SubmissionCard = {
  submissionId: string
  articleId: string
  slug: string
  round: number
  status: SubmissionStatus
  langs: Array<string>
  submittedAt: Date
  authorName: string
  title: string
  reviewers: number
  contradictors: number
}

/** Submissions still live, oldest first — a queue, not a stack. */
export async function listSubmissionQueue(): Promise<Array<SubmissionCard>> {
  const { db } = await import('./db')
  const rows = await db
    .select({
      submissionId: articleSubmission.id,
      articleId: articleSubmission.articleId,
      slug: article.slug,
      round: articleSubmission.round,
      status: articleSubmission.status,
      langs: articleSubmission.langs,
      submittedAt: articleSubmission.submittedAt,
      authorName: user.name,
    })
    .from(articleSubmission)
    .innerJoin(article, eq(article.id, articleSubmission.articleId))
    .innerJoin(user, eq(user.id, article.authorId))
    .where(inArray(articleSubmission.status, ['open', 'in_review']))
    .orderBy(articleSubmission.submittedAt)

  return Promise.all(
    rows.map(async (row) => {
      const panel = await db
        .select({ stance: articleReviewer.stance })
        .from(articleReviewer)
        .where(eq(articleReviewer.submissionId, row.submissionId))

      const [translation] = await db
        .select({ title: articleTranslation.title })
        .from(articleTranslation)
        .where(
          and(
            eq(articleTranslation.articleId, row.articleId),
            eq(articleTranslation.lang, row.langs[0] ?? ''),
          ),
        )
        .limit(1)

      return {
        ...row,
        title: translation?.title ?? row.slug,
        reviewers: panel.length,
        contradictors: panel.filter((p) => p.stance === 'contradictor').length,
      }
    }),
  )
}

/** One submission in full: its documentation, its panel, and every verdict. */
export async function getSubmission(submissionId: string) {
  const { db } = await import('./db')
  const [submission] = await db
    .select({
      id: articleSubmission.id,
      articleId: articleSubmission.articleId,
      slug: article.slug,
      round: articleSubmission.round,
      status: articleSubmission.status,
      langs: articleSubmission.langs,
      submittedAt: articleSubmission.submittedAt,
      diagnosis: articleSubmission.diagnosis,
      solutions: articleSubmission.solutions,
      resources: articleSubmission.resources,
      risks: articleSubmission.risks,
      indicators: articleSubmission.indicators,
      authorId: article.authorId,
      authorName: user.name,
    })
    .from(articleSubmission)
    .innerJoin(article, eq(article.id, articleSubmission.articleId))
    .innerJoin(user, eq(user.id, article.authorId))
    .where(eq(articleSubmission.id, submissionId))
    .limit(1)

  if (!submission) return null

  const verdicts = await db
    .select({
      lang: articleReview.lang,
      verdict: articleReview.verdict,
      rationale: articleReview.rationale,
      createdAt: articleReview.createdAt,
      reviewerId: articleReview.reviewerId,
      reviewerName: user.name,
    })
    .from(articleReview)
    .innerJoin(user, eq(user.id, articleReview.reviewerId))
    .where(eq(articleReview.submissionId, submissionId))
    .orderBy(articleReview.createdAt)

  const [decision] = await db
    .select()
    .from(articleDecision)
    .where(eq(articleDecision.submissionId, submissionId))
    .limit(1)

  return {
    submission,
    reviewers: await listReviewers(submissionId),
    verdicts,
    tallies: await tallySubmission(submissionId),
    decision: decision ?? null,
  }
}

/** Every round an article has been through, newest first. */
export async function listRounds(articleId: string) {
  const { db } = await import('./db')
  return db
    .select({
      submissionId: articleSubmission.id,
      round: articleSubmission.round,
      status: articleSubmission.status,
      langs: articleSubmission.langs,
      submittedAt: articleSubmission.submittedAt,
      outcome: articleDecision.outcome,
      method: articleDecision.method,
      decidedAt: articleDecision.decidedAt,
    })
    .from(articleSubmission)
    .leftJoin(articleDecision, eq(articleDecision.submissionId, articleSubmission.id))
    .where(eq(articleSubmission.articleId, articleId))
    .orderBy(desc(articleSubmission.round))
}

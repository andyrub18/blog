import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { article } from './article'
import { user } from './auth'

/**
 * The manifesto's four-stage deliberation, as tables.
 *
 * These exist now, with the article schema, although nothing writes to them
 * until phase 3. That is deliberate and it is the instruction in
 * `docs/phases/02-ARTICLES-REVIEW.md`: retrofitting a review process onto
 * articles that were already published means inventing a history for them, and
 * a review trail that begins halfway through is not a review trail.
 *
 * A binary approve/reject button would make this Medium with extra steps.
 * Building the documented submission, the assigned contradictors, the synthesis
 * and the qualified majority is the reason KLE needs its own platform.
 */

export const SUBMISSION_STATUSES = ['open', 'in_review', 'decided', 'withdrawn'] as const
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

/**
 * A proposal put to the circle.
 *
 * The five documentation columns are the manifesto's admissibility test, not a
 * form we invented: a proposal states the diagnosis, the solutions considered,
 * the resources required, the risks identified and how success will be
 * measured. They are `NOT NULL` because an undocumented proposal is not
 * admissible — the form *is* the standard.
 */
export const articleSubmission = pgTable(
  'article_submission',
  {
    id: text('id').primaryKey(),
    articleId: text('article_id')
      .notNull()
      .references(() => article.id, { onDelete: 'cascade' }),
    /**
     * Revisions open a new round rather than overwriting the last one, so the
     * argument history survives. What a contradictor objected to in round two
     * is the reason round three reads the way it does.
     */
    round: integer('round').notNull().default(1),
    /**
     * The languages this submission puts to the circle.
     *
     * A submission covers one or more `(article_id, lang)` variants, because
     * reviewers validate the languages they can read and the decision is taken
     * per language. An author who has only written the French submits only the
     * French; the Creole comes back as its own round when it exists.
     */
    langs: jsonb('langs').$type<Array<string>>().notNull(),
    submittedBy: text('submitted_by').references(() => user.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').$type<SubmissionStatus>().notNull().default('open'),
    diagnosis: text('diagnosis').notNull(),
    solutions: text('solutions').notNull(),
    resources: text('resources').notNull(),
    risks: text('risks').notNull(),
    indicators: text('indicators').notNull(),
  },
  (table) => [
    index('article_submission_article_idx').on(table.articleId),
    /**
     * One live submission per article — not one ever.
     *
     * Two concurrent submissions on the same article would split the assigned
     * reviewers and could produce two different answers about the same text.
     * Closed rounds are left alone, which is what makes a revision a new round
     * rather than an overwrite.
     */
    uniqueIndex('one_open_submission_per_article')
      .on(table.articleId)
      .where(sql`${table.status} in ('open', 'in_review')`),
  ],
)

/**
 * `contradictor` is a job, not a mood.
 *
 * At least one named member is assigned to argue *against* the proposal — to
 * surface flaws, blind spots and unverified assumptions. Assigned by a senior
 * member, never self-selected: a volunteer contradictor is an ally or an
 * opponent, and either way the circle chose neither.
 */
export const REVIEWER_STANCES = ['contradictor', 'reviewer'] as const
export type ReviewerStance = (typeof REVIEWER_STANCES)[number]

export const articleReviewer = pgTable(
  'article_reviewer',
  {
    submissionId: text('submission_id')
      .notNull()
      .references(() => articleSubmission.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    stance: text('stance').$type<ReviewerStance>().notNull(),
    assignedBy: text('assigned_by').references(() => user.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.submissionId, table.userId] })],
)

export const REVIEW_VERDICTS = ['support', 'object', 'abstain'] as const
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number]

export const articleReview = pgTable(
  'article_review',
  {
    id: text('id').primaryKey(),
    submissionId: text('submission_id')
      .notNull()
      .references(() => articleSubmission.id, { onDelete: 'cascade' }),
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Which language of the article this reviewer read and is speaking to. */
    lang: text('lang').notNull(),
    verdict: text('verdict').$type<ReviewVerdict>().notNull(),
    /**
     * Required, like every other decision in the movement. A verdict without
     * reasoning is a popularity vote, which is the thing being rejected.
     */
    rationale: text('rationale').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('article_review_submission_idx').on(table.submissionId),
    /**
     * One verdict per reviewer per language.
     *
     * Per *language*, not per submission: a reviewer who reads both French and
     * Creole speaks to both, and their two verdicts may honestly differ — the
     * argument can be sound in one language and badly rendered in the other.
     * What they may not do is vote twice on the same text.
     */
    uniqueIndex('one_verdict_per_reviewer_per_lang').on(
      table.submissionId,
      table.reviewerId,
      table.lang,
    ),
  ],
)

/** Never a simple majority — consensus, or two thirds of the votes cast. */
export const DECISION_METHODS = ['consensus', 'qualified_majority'] as const
export type DecisionMethod = (typeof DECISION_METHODS)[number]

export const DECISION_OUTCOMES = ['accepted', 'revision_requested', 'rejected'] as const
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number]

/**
 * The shape of `tally_json`, declared rather than left as `unknown`.
 *
 * A `jsonb` column types as `unknown` by default, which a server function
 * refuses to serialise — correctly, since it cannot know the value is
 * JSON-safe. Naming the shape here is also the more useful half: this record is
 * what somebody reads years later to see how a decision was reached, and it
 * should not be a bag nobody can describe.
 */
export type DecisionTallyEntry = {
  lang: string
  supports: number
  objections: number
  abstentions: number
  contradicted: boolean
  accepted: boolean
  method: DecisionMethod
  reason: string
}

export type DecisionTally = {
  /** The senior member's written reason for closing the round. */
  rationale: string
  languages: Array<DecisionTallyEntry>
}

export const articleDecision = pgTable(
  'article_decision',
  {
    id: text('id').primaryKey(),
    submissionId: text('submission_id')
      .notNull()
      .references(() => articleSubmission.id, { onDelete: 'cascade' }),
    outcome: text('outcome').$type<DecisionOutcome>().notNull(),
    method: text('method').$type<DecisionMethod>().notNull(),
    /**
     * The individual positions, kept with the decision.
     *
     * The tally is the account of how the circle got here; a bare outcome would
     * make the result unauditable the moment anybody disputes it.
     */
    tallyJson: jsonb('tally_json').$type<DecisionTally>().notNull(),
    decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // One decision per submission. A second would not be a correction, it would
  // be a contradiction with no record of which one the circle meant.
  (table) => [uniqueIndex('one_decision_per_submission').on(table.submissionId)],
)

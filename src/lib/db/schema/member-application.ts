import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { user } from './auth'

/** How this application arrived: the public process, or a sponsor's invitation. */
export const APPLICATION_ORIGINS = ['application', 'invitation'] as const
export type ApplicationOrigin = (typeof APPLICATION_ORIGINS)[number]

export const MEMBER_APPLICATION_STATUSES = [
  'pending',
  'under_review',
  'needs_more_info',
  'approved',
  'rejected',
] as const
export type MemberApplicationStatus = (typeof MEMBER_APPLICATION_STATUSES)[number]

/** The statuses that mean an application is still open. */
export const OPEN_APPLICATION_STATUSES = [
  'pending',
  'under_review',
  'needs_more_info',
] as const satisfies ReadonlyArray<MemberApplicationStatus>

export const memberApplication = pgTable(
  'member_application',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * The three dossier PDFs.
     *
     * Nullable only because of cooptation. An invited member is vouched for by
     * a senior member instead of being reviewed on a dossier, so their CV and
     * vision essay may be deferred — but never their contribution plan, which
     * is what the six-month probation review evaluates them against. The public
     * application path always writes all three; `origin` says which path this
     * row came from, so a reviewer looking at a dossier with no CV can see why.
     */
    cvPath: text('cv_path'),
    visionEssayPath: text('vision_essay_path'),
    contributionEssayPath: text('contribution_essay_path'),
    /**
     * The contribution plan as structured text, not only a PDF.
     *
     * The six-month probation review checks the member against what they said
     * they would do; a PDF nobody can query leaves that review with nothing to
     * evaluate.
     */
    contributionPlan: text('contribution_plan'),
    status: text('status').$type<MemberApplicationStatus>().notNull().default('pending'),
    origin: text('origin').$type<ApplicationOrigin>().notNull().default('application'),
    /** Senior member's written reason, required for a decision. */
    decisionRationale: text('decision_rationale'),
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    /**
     * One OPEN application per person — not one ever.
     *
     * The column used to carry a plain UNIQUE constraint, which permanently
     * barred anyone rejected once from ever applying again. A partial index
     * keeps the "no duplicate open applications" rule while preserving the
     * history and allowing a second attempt.
     */
    uniqueIndex('one_open_application_per_user')
      .on(table.userId)
      .where(sql`${table.status} in ('pending', 'under_review', 'needs_more_info')`),
  ],
)

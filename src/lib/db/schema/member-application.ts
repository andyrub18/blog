import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { user } from './auth'

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
    cvPath: text('cv_path').notNull(),
    visionEssayPath: text('vision_essay_path').notNull(),
    contributionEssayPath: text('contribution_essay_path').notNull(),
    /**
     * The contribution plan as structured text, not only a PDF.
     *
     * The six-month probation review checks the member against what they said
     * they would do; a PDF nobody can query leaves that review with nothing to
     * evaluate.
     */
    contributionPlan: text('contribution_plan'),
    status: text('status').$type<MemberApplicationStatus>().notNull().default('pending'),
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

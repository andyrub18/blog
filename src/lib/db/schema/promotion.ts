import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { user } from './auth'

/**
 * Promotion to senior member — *manm senyò* — by qualified majority.
 *
 * Not one person's click. A senior member can read every applicant's CV and
 * decide who joins the movement; granting that is exactly the kind of
 * consequential decision the manifesto refuses to settle by simple majority. So
 * a nomination is opened, every senior member votes with a written reason, and
 * the outcome is whatever the arithmetic says.
 */
export const PROMOTION_STATUSES = ['open', 'approved', 'rejected', 'withdrawn'] as const
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number]

export const seniorPromotion = pgTable(
  'senior_promotion',
  {
    id: text('id').primaryKey(),
    subjectUserId: text('subject_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Senior member who opened the nomination, and why. */
    openedBy: text('opened_by').references(() => user.id, { onDelete: 'set null' }),
    rationale: text('rationale').notNull(),
    status: text('status').$type<PromotionStatus>().notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * One open nomination per person, history kept.
     *
     * Two concurrent votes on the same member would split the electorate and
     * could produce two different answers. A closed nomination is left alone, so
     * someone passed over once may be nominated again later.
     */
    uniqueIndex('one_open_promotion_per_user')
      .on(table.subjectUserId)
      .where(sql`${table.status} = 'open'`),
  ],
)

export const PROMOTION_VOTES = ['approve', 'reject'] as const
export type PromotionVote = (typeof PROMOTION_VOTES)[number]

export const seniorPromotionVote = pgTable(
  'senior_promotion_vote',
  {
    id: text('id').primaryKey(),
    promotionId: text('promotion_id')
      .notNull()
      .references(() => seniorPromotion.id, { onDelete: 'cascade' }),
    voterId: text('voter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    vote: text('vote').$type<PromotionVote>().notNull(),
    /**
     * Required, like every other decision in the movement.
     *
     * Votes are recorded individually and attributably. A secret ballot would
     * protect the voters; naming them protects the person being voted on, which
     * is what *reddition de comptes* asks for here.
     */
    rationale: text('rationale').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('one_vote_per_senior_member').on(table.promotionId, table.voterId),
    index('senior_promotion_vote_promotion_idx').on(table.promotionId),
  ],
)

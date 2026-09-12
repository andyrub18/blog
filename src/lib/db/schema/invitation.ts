import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'

/**
 * Cooptation: an invitation issued by hand to someone already known.
 *
 * The manifesto provides for it, and it is how the first cohort forms at all —
 * there is nobody to review the reviewers. What it skips is the committee
 * review, because the sponsor's judgement replaces it. What it keeps is
 * everything that protects the movement afterwards: email verification, the
 * contribution plan the probation review needs, the six-month probation itself,
 * and a record naming the sponsor.
 */
export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    /**
     * SHA-256 of the token, never the token itself.
     *
     * The raw token exists only in the emailed link. Stored in the clear, a
     * leaked database backup would be a set of working membership grants, and a
     * rogue read of this table would let anyone mint an account in someone
     * else's name.
     */
    tokenHash: text('token_hash').notNull().unique(),
    /** Who it was issued to — the account must be created with this address. */
    email: text('email').notNull(),
    invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
    /** Why this person, in the sponsor's own words. Kept with the audit trail. */
    note: text('note').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedByUserId: text('used_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    /** Set when the sponsor withdraws it before it is used. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('invitation_email_idx').on(table.email),
    index('invitation_inviter_idx').on(table.invitedBy),
  ],
)

import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'

/**
 * Append-only audit trail.
 *
 * Never updated, never deleted. The manifesto commits KLE to *transparence
 * totale* and *reddition de comptes*; these tables are that commitment in code.
 * `access_event` in particular is the only honest basis for telling a member
 * that their CV is not being passed around, because it records every time
 * somebody opened it.
 */

export const ROLE_CHANGE_REASONS = [
  'application_approved',
  'application_rejected',
  'probation_confirmed',
  'probation_reverted',
  'promoted',
  'demoted',
  'blocked',
  'unblocked',
  'seeded',
] as const
export type RoleChangeReason = (typeof ROLE_CHANGE_REASONS)[number]

export const roleChange = pgTable(
  'role_change',
  {
    id: text('id').primaryKey(),
    subjectUserId: text('subject_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    fromRole: text('from_role').notNull(),
    toRole: text('to_role').notNull(),
    reason: text('reason').$type<RoleChangeReason>().notNull(),
    /** Required. A role change without a stated reason is not accountable. */
    rationale: text('rationale').notNull(),
    /** Null when the system acted, e.g. the seed script. */
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('role_change_subject_idx').on(table.subjectUserId)],
)

export const applicationEvent = pgTable(
  'application_event',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    rationale: text('rationale'),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('application_event_application_idx').on(table.applicationId)],
)

export const ACCESS_ACTIONS = ['view', 'download'] as const
export type AccessAction = (typeof ACCESS_ACTIONS)[number]

/**
 * Every privileged read of someone else's data.
 *
 * This is how an insider leak is detected. A log nobody reads is a log file, so
 * it is indexed by actor as well as resource — the question you actually ask is
 * "what did this account open", not "who opened this file".
 */
export const accessEvent = pgTable(
  'access_event',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    action: text('action').$type<AccessAction>().notNull(),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('access_event_actor_idx').on(table.actorId),
    index('access_event_resource_idx').on(table.resourceType, table.resourceId),
  ],
)

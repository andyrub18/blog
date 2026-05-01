import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const MEMBER_APPLICATION_STATUSES = [
  'pending',
  'approved',
  'rejected',
] as const
export type MemberApplicationStatus = (typeof MEMBER_APPLICATION_STATUSES)[number]

export const memberApplication = pgTable('member_application', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  cvPath: text('cv_path').notNull(),
  visionEssayPath: text('vision_essay_path').notNull(),
  contributionEssayPath: text('contribution_essay_path').notNull(),
  status: text('status').$type<MemberApplicationStatus>().notNull().default('pending'),
  reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

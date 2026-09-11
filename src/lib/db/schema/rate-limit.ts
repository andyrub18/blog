import { bigint, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Better Auth's own rate-limit store (`rateLimit.storage: 'database'`).
 *
 * The shape is dictated by Better Auth, not by us — key, count, lastRequest —
 * so do not "tidy" it. It covers traffic that reaches `/api/auth/*`.
 */
export const rateLimit = pgTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})

/**
 * Our own fixed-window counters, for the flows Better Auth never sees.
 *
 * Sign-in and sign-up run through server functions that call `auth.api.*`
 * in-process, so they never touch `/api/auth/*` and Better Auth's limiter — or
 * its captcha plugin — never runs for them. This table backs `lib/rate-limit.ts`.
 *
 * Kept in Postgres rather than in memory on purpose: an in-memory counter
 * resets on every deploy and is per-instance, so an attacker gets a fresh
 * budget from each. Rows self-expire by `expiresAt` and are swept
 * opportunistically.
 */
export const authThrottle = pgTable('auth_throttle', {
  /** `<action>:<subject>` — e.g. `sign-in:ip:41.87.x.x` or `sign-in:email:a@b.ht`. */
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

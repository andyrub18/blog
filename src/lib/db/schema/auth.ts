import { boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * The membership ladder, in the manifesto's own vocabulary (DECISIONS.md, D2).
 *
 * `senior_member` is *manm senyò* — the admission committee. `member` is *manm*,
 * admitted by dossier. `reader` is *lektè*. Using the movement's words here
 * means nobody has to keep a translation table in their head.
 */
export const ROLES = ['super_admin', 'senior_member', 'member', 'reader'] as const
export type Role = (typeof ROLES)[number]

/** Ascending authority, for "at least this role" checks. */
export const ROLE_RANK: Record<Role, number> = {
  reader: 0,
  member: 1,
  senior_member: 2,
  super_admin: 3,
}

export function hasAtLeastRole(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum]
}

export const MEMBER_STATUSES = ['active', 'pending', 'rejected', 'blocked'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role').$type<Role>().notNull().default('reader'),
  memberStatus: text('member_status').$type<MemberStatus>().notNull().default('active'),
  dateOfBirth: timestamp('date_of_birth', { mode: 'date' }),
  essay: text('essay'),
  /** Set when a member is admitted; the probation clock starts here. */
  memberSince: timestamp('member_since', { withTimezone: true }),
  /**
   * End of the manifesto's six-month probation. While this is in the future the
   * member is admitted but not yet confirmed; the circle evaluates them against
   * their contribution plan when it passes.
   */
  probationUntil: timestamp('probation_until', { withTimezone: true }),
  /**
   * When the circle confirmed the member at the end of their probation.
   *
   * Its own column rather than something inferred from clearing
   * `probation_until`, because two different questions are being asked: when
   * probation ended, and whether it was ever decided. Inferring would make a
   * confirmed member indistinguishable from one who never had a clock, and
   * would erase the date the circle actually met. Null while probation runs,
   * and null again for a member reverted to reader — the `role_change` row
   * carries that story.
   */
  probationConfirmedAt: timestamp('probation_confirmed_at', { withTimezone: true }),
  /** Senior member who vouched, when the account arrived by cooptation. */
  sponsoredBy: text('sponsored_by'),
  /**
   * Sign-in asks for a code from an authenticator app as well as the password
   * (D40). Opt-in for now; written by Better Auth's two-factor plugin, never by us.
   */
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

/**
 * The authenticator secret and backup codes behind `user.twoFactorEnabled`.
 *
 * The shape is Better Auth's two-factor plugin's. Both secrets are stored
 * encrypted with the server's secret, so a copy of the database, a backup
 * included, cannot produce codes. `verified` stays false until the person has
 * typed one code from their app, which is what proves the setup worked;
 * `failed_verification_count` and `locked_until` are the plugin's lockout.
 */
export const twoFactor = pgTable(
  'two_factor',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until'),
  },
  // Every sign-in that asks for a code looks the row up by its user.
  (table) => [index('two_factor_user_idx').on(table.userId)],
)

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { env } from '../env'
import { tanstackStartCookies } from './auth-cookies'
import { db } from './db'
import * as schema from './db/schema'

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: true,
    autoSignIn: false,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const [{ getMailer }, { renderVerificationEmail }, { resolveRequestLocale }] =
        await Promise.all([
          import('./email/mailer'),
          import('./email/templates'),
          import('./email/locale'),
        ])
      const locale = resolveRequestLocale()
      const message = renderVerificationEmail({
        name: user.name,
        url,
        locale,
      })
      const result = await getMailer().send({ to: user.email, ...message })
      if (!result.ok) {
        // Surface it: Better Auth reports signup as successful either way, and
        // a silently undelivered verification email looks to the applicant like
        // the account simply never worked.
        throw new Error(`Could not send verification email: ${result.error}`)
      }
    },
  },
  /**
   * Rate limiting for traffic that actually reaches `/api/auth/*` — the
   * verification callback, OAuth callbacks, anything the client calls directly.
   *
   * It does NOT cover sign-in or sign-up: those run through server functions
   * that call `auth.api.*` in-process and never touch this path. Their
   * throttling lives in `guard()` in `auth-actions.ts`.
   *
   * Stored in the database so limits survive a deploy and are shared across
   * instances; in memory an attacker gets a fresh budget from each.
   */
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 60,
    customRules: {
      '/verify-email': { window: 60 * 15, max: 10 },
      '/send-verification-email': { window: 60 * 60, max: 5 },
      '/forget-password': { window: 60 * 60, max: 5 },
      '/reset-password': { window: 60 * 15, max: 10 },
      '/sign-in/email': { window: 60 * 15, max: 10 },
      '/sign-up/email': { window: 60 * 60, max: 5 },
    },
  },
  // Must stay last: it reads the headers every other plugin has written.
  plugins: [tanstackStartCookies()],
  user: {
    additionalFields: {
      role: {
        type: 'string',
        input: false,
        defaultValue: 'reader',
      },
      memberStatus: {
        type: 'string',
        input: false,
        defaultValue: 'active',
        fieldName: 'memberStatus',
      },
      dateOfBirth: {
        type: 'date',
        required: false,
        input: true,
      },
      essay: {
        type: 'string',
        required: false,
        input: true,
      },
    },
  },
})

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { eq } from 'drizzle-orm'
import { env } from '../../env'
import { db } from '../db'
import * as schema from '../db/schema'
import { tanstackStartCookies } from './auth-cookies'
import { servedOverHttps } from './transport'

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
    resetPasswordTokenExpiresIn: 60 * 60,
    /**
     * A reset signs out every device. Somebody resets because they lost the
     * password or because somebody else has it; in the second case, a session
     * that outlives the reset keeps the intruder in.
     */
    revokeSessionsOnPasswordReset: true,
    /**
     * The mail is sent, not awaited. Better Auth answers an unknown address
     * at once, and a known one only after this callback returns; awaiting the
     * mailer would make "this person has an account" a matter of timing the
     * reply. The mailer logs its own failures, and the person is told the same
     * thing either way (`requestPasswordReset` in `password-reset-actions.ts`).
     */
    sendResetPassword: async ({ user, url }) => {
      const [{ getMailer }, { renderPasswordResetEmail }, { resolveRequestLocale }] =
        await Promise.all([
          import('../email/mailer'),
          import('../email/templates'),
          import('../email/locale'),
        ])
      const message = renderPasswordResetEmail({
        name: user.name,
        url,
        locale: resolveRequestLocale(),
      })
      void getMailer()
        .send({ to: user.email, ...message })
        .catch(() => {})
    },
    /**
     * Following the link proves the address, which is all verification asks.
     * Without this, somebody whose verification mail never arrived could reset
     * their password and still be refused at sign-in for an unverified address.
     */
    onPasswordReset: async ({ user }) => {
      if (user.emailVerified) return
      await db
        .update(schema.user)
        .set({ emailVerified: true, updatedAt: new Date() })
        .where(eq(schema.user.id, user.id))
    },
  },
  /**
   * Reset tokens are stored as their SHA-256, not as themselves. For an hour
   * each is a way into somebody's account, and the database is copied into
   * backups (SECURITY.md P4); a copy should not hold working links.
   */
  verification: { storeIdentifier: 'hashed' },
  /**
   * Closed over HTTP; the server functions in `password-reset-actions.ts` call
   * them in-process, behind `guard()`. Open, `/request-password-reset` would
   * send mail to any address with only Better Auth's per-IP limit in the way,
   * and none per address. The link in the mail, `/reset-password/<token>`, is
   * a different path and stays open.
   */
  disabledPaths: ['/request-password-reset', '/reset-password'],
  emailVerification: {
    /**
     * Sent by `runSignUp`, not here.
     *
     * `sendOnSignUp` fires inside `signUpEmail`, after the user row exists, and
     * the callback below throws when the mailer fails — so a Resend outage took
     * the whole sign-up down with it and returned `UNEXPECTED` for an account
     * that had in fact been created. The applicant was told to try again, could
     * not (the address was taken), and had no way to ask for another
     * verification email. Sending it from `runSignUp` puts the failure where it
     * can be reported without pretending the account does not exist.
     */
    sendOnSignUp: false,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const [{ getMailer }, { renderVerificationEmail }, { resolveRequestLocale }] =
        await Promise.all([
          import('../email/mailer'),
          import('../email/templates'),
          import('../email/locale'),
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
  /**
   * Session cookies: `httpOnly` and `sameSite=lax` always, and `secure` — with
   * the `__Secure-` prefix — whenever the site is served over HTTPS. Better Auth
   * would infer the last from `BETTER_AUTH_URL`; it is written out so the choice
   * is visible here, and `assertSecureTransport` makes sure production is never
   * the case where it comes out false (SECURITY.md P0 #6).
   */
  advanced: {
    useSecureCookies: servedOverHttps(),
    defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    /**
     * Better Auth's own limiter, on `/api/auth/*`, reads the client address the
     * same way `clientIp` does — from the one header the proxy sets. Left to its
     * default it takes the first entry of `x-forwarded-for`, which the client
     * writes.
     */
    ...(process.env.CLIENT_IP_HEADER
      ? {
          ipAddress: {
            ipAddressHeaders: [process.env.CLIENT_IP_HEADER.trim().toLowerCase()],
          },
        }
      : {}),
  },
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 60,
    customRules: {
      '/verify-email': { window: 60 * 15, max: 10 },
      '/send-verification-email': { window: 60 * 60, max: 5 },
      // No rules for resets: both endpoints are closed over HTTP (above), and
      // `/forget-password`, which used to be listed here, is no longer a path.
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

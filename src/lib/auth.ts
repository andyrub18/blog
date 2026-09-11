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

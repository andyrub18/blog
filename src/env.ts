function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const env = {
  get DATABASE_URL() {
    return required('DATABASE_URL')
  },
  get BETTER_AUTH_SECRET() {
    return required('BETTER_AUTH_SECRET')
  },
  get BETTER_AUTH_URL() {
    return process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
  },
  /**
   * Resend credentials. Optional in development — without them the mailer
   * prints to the console (see `lib/email/mailer.ts`) — but `getMailer()`
   * refuses to start in production unless both are present.
   */
  get RESEND_API_KEY() {
    return process.env.RESEND_API_KEY
  },
  get EMAIL_FROM() {
    return process.env.EMAIL_FROM
  },
  /**
   * Cloudflare Turnstile. The site key is public and reaches the browser; the
   * secret key must not. Both absent in development disables the captcha;
   * `assertCaptchaConfigured()` refuses that in production.
   */
  get TURNSTILE_SITE_KEY() {
    return process.env.TURNSTILE_SITE_KEY
  },
  get TURNSTILE_SECRET_KEY() {
    return process.env.TURNSTILE_SECRET_KEY
  },
}

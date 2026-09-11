import type { RenderedEmail } from './templates'

export type SendResult = { ok: true; id?: string } | { ok: false; error: string }

export type Mailer = {
  send: (message: RenderedEmail & { to: string }) => Promise<SendResult>
}

/**
 * Development transport: prints the message instead of sending it.
 *
 * Used when `RESEND_API_KEY` is absent so the app runs locally without an email
 * provider. It refuses to run in production — a silent no-op there would mean
 * nobody can ever verify an address, and the failure would look like "the email
 * is slow" rather than "no email was ever sent".
 */
export function createConsoleMailer(): Mailer {
  return {
    async send({ to, subject, text }) {
      console.info(`\n[email:dev] to=${to}\n[email:dev] subject=${subject}\n${text}\n`)
      return { ok: true }
    },
  }
}

export function createResendMailer(apiKey: string, from: string): Mailer {
  return {
    async send({ to, subject, html, text }) {
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(apiKey)
        const { data, error } = await resend.emails.send({
          from,
          to,
          subject,
          html,
          text,
        })
        if (error) {
          // Never log the message body or the verification URL: logs are read
          // by more people than the inbox is, and that link grants access.
          console.error(`[email] send failed: ${error.name}: ${error.message}`)
          return { ok: false, error: error.message }
        }
        return { ok: true, id: data?.id }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[email] transport error: ${message}`)
        return { ok: false, error: message }
      }
    },
  }
}

let cached: Mailer | undefined

/** The configured mailer, chosen once from the environment. */
export function getMailer(): Mailer {
  if (cached) return cached
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM

  if (apiKey && from) {
    cached = createResendMailer(apiKey, from)
    return cached
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'RESEND_API_KEY and EMAIL_FROM must be set in production. ' +
        'Without them no verification email is ever delivered and no account ' +
        'can be activated.',
    )
  }

  console.warn(
    '[email] RESEND_API_KEY/EMAIL_FROM not set — printing emails to the console.',
  )
  cached = createConsoleMailer()
  return cached
}

/** Test seam: reset the memoised mailer. */
export function resetMailer(): void {
  cached = undefined
}

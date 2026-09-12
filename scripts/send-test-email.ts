/**
 * Send a real verification email, to check the provider end to end.
 *
 *   npm run email:test -- aruban@unibankhaiti.com ht
 *
 * The link inside is deliberately fake — this exercises rendering and delivery,
 * not account verification.
 */
import { getMailer } from '../src/lib/email/mailer'
import { renderVerificationEmail } from '../src/lib/email/templates'
import { isLocale, DEFAULT_LOCALE } from '../src/i18n'

const to = process.argv[2]
const localeArg = process.argv[3]

if (!to) {
  console.error('Usage: npm run email:test -- <recipient> [locale]')
  process.exit(1)
}

const locale = isLocale(localeArg) ? localeArg : DEFAULT_LOCALE

const message = renderVerificationEmail({
  name: 'Anderson',
  url: 'https://kle.ht/api/auth/verify-email?token=TEST-TOKEN-NOT-REAL',
  locale,
})

console.info(`from    : ${process.env.EMAIL_FROM ?? '(unset)'}`)
console.info(`to      : ${to}`)
console.info(`locale  : ${locale}`)
console.info(`subject : ${message.subject}`)

const result = await getMailer().send({ to, ...message })
console.info('result  :', JSON.stringify(result))
process.exit(result.ok ? 0 : 1)

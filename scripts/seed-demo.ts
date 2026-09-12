/**
 * Seed accounts for exercising the enrollment and review flows locally.
 *
 * Run with: npm run db:seed:demo
 *
 * Refuses to run in production. These are known-password accounts; creating
 * them on a deployed server would hand anyone who reads this file a senior
 * member account, and with it every applicant's CV.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { auth } from '../src/lib/auth'
import { db } from '../src/lib/db'
import {
  applicationEvent,
  authThrottle,
  memberApplication,
  roleChange,
  user as userTable,
  type Role,
} from '../src/lib/db/schema'

const PASSWORD = 'demo-password-123'

const ACCOUNTS = [
  { key: 'senior', name: 'Manm Senyò', email: 'senior@kle.test', role: 'senior_member' },
  { key: 'reader', name: 'Lektè', email: 'reader@kle.test', role: 'reader' },
  { key: 'applicant', name: 'Kandida', email: 'applicant@kle.test', role: 'reader' },
  // Pristine on purpose: tests that only look at the application form must not
  // share an account with tests that submit one, or they depend on run order.
  { key: 'newcomer', name: 'Nouvo', email: 'newcomer@kle.test', role: 'reader' },
] as const satisfies ReadonlyArray<{
  key: string
  name: string
  email: string
  role: Role
}>

/** A byte-valid PDF, so the magic-byte check and the download path both work. */
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
)

async function ensureAccount(account: (typeof ACCOUNTS)[number]): Promise<string> {
  const [existing] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, account.email))
    .limit(1)

  if (existing) {
    await db
      .update(userTable)
      .set({ role: account.role, emailVerified: true, memberStatus: 'active' })
      .where(eq(userTable.id, existing.id))
    console.info(`· ${account.email} already existed — role reset to ${account.role}`)
    return existing.id
  }

  const result = await auth.api.signUpEmail({
    body: { name: account.name, email: account.email, password: PASSWORD },
    headers: new Headers(),
  })

  await db
    .update(userTable)
    .set({ role: account.role, emailVerified: true, memberStatus: 'active' })
    .where(eq(userTable.id, result.user.id))

  // Even a seeded role gets an audit row. A role nobody can account for is
  // exactly what the audit trail exists to prevent.
  await db.insert(roleChange).values({
    id: randomUUID(),
    subjectUserId: result.user.id,
    fromRole: 'reader',
    toRole: account.role,
    reason: 'seeded',
    rationale: 'Created by the demo seed script.',
    actorId: null,
  })

  console.info(`· created ${account.email} (${account.role})`)
  return result.user.id
}

async function ensurePendingApplication(userId: string): Promise<void> {
  const [existing] = await db
    .select({ id: memberApplication.id })
    .from(memberApplication)
    .where(eq(memberApplication.userId, userId))
    .limit(1)
  if (existing) {
    console.info('· applicant already has an application — skipping')
    return
  }

  const id = randomUUID()
  const paths: Record<string, string> = {}
  for (const field of ['cv', 'vision', 'contribution'] as const) {
    const relative = `member-applications/${userId}/${field}-${randomUUID()}-${field}.pdf`
    const absolute = join(process.cwd(), 'uploads', relative)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, MINIMAL_PDF)
    paths[field] = relative
  }

  await db.insert(memberApplication).values({
    id,
    userId,
    cvPath: paths.cv,
    visionEssayPath: paths.vision,
    contributionEssayPath: paths.contribution,
    contributionPlan:
      'Je propose de coordonner un cycle de lectures sur les politiques ' +
      'éducatives haïtiennes, de produire une note de position par trimestre, ' +
      'et de mettre mes compétences en analyse de données au service du ' +
      'Cercle Économie pour documenter les projets financés par le Fonds.',
    status: 'pending',
  })

  await db.insert(applicationEvent).values({
    id: randomUUID(),
    applicationId: id,
    fromStatus: null,
    toStatus: 'pending',
    actorId: userId,
  })

  console.info('· created a pending application for the applicant')
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_LOCAL !== 'true') {
    console.error(
      'Refusing to seed demo accounts in production: they have a known password.',
    )
    process.exit(1)
  }

  // Clear the throttle counters. Repeated sign-ins during local testing trip
  // the per-IP limit, and behind no proxy every local client shares the single
  // `unknown` bucket — so one test run locks out the next.
  await db.delete(authThrottle)
  console.info('· cleared rate-limit counters')

  const ids: Record<string, string> = {}
  for (const account of ACCOUNTS) {
    ids[account.key] = await ensureAccount(account)
  }
  await ensurePendingApplication(ids.applicant)

  console.info(`\nDemo accounts (password: ${PASSWORD})`)
  for (const account of ACCOUNTS) {
    console.info(`  ${account.email.padEnd(22)} ${account.role}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

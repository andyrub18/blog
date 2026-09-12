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
import { eq, inArray } from 'drizzle-orm'
import { auth } from '../src/lib/auth'
import { db } from '../src/lib/db'
import {
  applicationEvent,
  authThrottle,
  invitation,
  memberApplication,
  roleChange,
  seniorPromotion,
  seniorPromotionVote,
  user as userTable,
  type Role,
} from '../src/lib/db/schema'

const PASSWORD = 'demo-password-123'

const ACCOUNTS = [
  { key: 'senior', name: 'Manm Senyò', email: 'senior@kle.test', role: 'senior_member' },
  // Three senior members, because three approvals is the floor for a promotion.
  // With fewer, the qualified majority can never be reached and the promotion
  // flow cannot be exercised at all.
  { key: 'senior2', name: 'Manm Senyò 2', email: 'senior2@kle.test', role: 'senior_member' },
  { key: 'senior3', name: 'Manm Senyò 3', email: 'senior3@kle.test', role: 'senior_member' },
  // Probation behind them: the only kind of member who may be nominated.
  { key: 'confirmed', name: 'Manm Konfime', email: 'confirmed@kle.test', role: 'member' },
  // Reserved for the blocking test, so it does not lock another test's account.
  { key: 'blockable', name: 'Manm Regilye', email: 'blockable@kle.test', role: 'member' },
  { key: 'reader', name: 'Lektè', email: 'reader@kle.test', role: 'reader' },
  { key: 'applicant', name: 'Kandida', email: 'applicant@kle.test', role: 'reader' },
  // Admitted member whose six months are up: the probation queue's subject.
  { key: 'probationer', name: 'Manm an Esè', email: 'probationer@kle.test', role: 'member' },
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

/**
 * State every seeded account goes back to.
 *
 * The membership fields are cleared on purpose: a previous run's review and
 * probation decisions would otherwise leave the next run with an empty queue
 * and nothing to exercise.
 */
const RESET_STATE = {
  emailVerified: true,
  memberStatus: 'active',
  memberSince: null,
  probationUntil: null,
  probationConfirmedAt: null,
} as const

async function ensureAccount(account: (typeof ACCOUNTS)[number]): Promise<string> {
  const [existing] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, account.email))
    .limit(1)

  if (existing) {
    await db
      .update(userTable)
      .set({ ...RESET_STATE, role: account.role })
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
    .set({ ...RESET_STATE, role: account.role })
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

const PLAN =
  'Je propose de coordonner un cycle de lectures sur les politiques ' +
  'éducatives haïtiennes, de produire une note de position par trimestre, ' +
  'et de mettre mes compétences en analyse de données au service du ' +
  'Cercle Économie pour documenter les projets financés par le Fonds.'

/** Write the three dossier PDFs for a user and return their stored paths. */
async function writeDossier(userId: string): Promise<Record<string, string>> {
  const paths: Record<string, string> = {}
  for (const field of ['cv', 'vision', 'contribution'] as const) {
    const relative = `member-applications/${userId}/${field}-${randomUUID()}-${field}.pdf`
    const absolute = join(process.cwd(), 'uploads', relative)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, MINIMAL_PDF)
    paths[field] = relative
  }
  return paths
}

/**
 * Put a demo user's application back to a known status.
 *
 * Replaces rather than skips: a run that approved the applicant would otherwise
 * leave the next run with an empty review queue.
 */
async function clearApplications(userId: string): Promise<void> {
  const existing = await db
    .select({ id: memberApplication.id })
    .from(memberApplication)
    .where(eq(memberApplication.userId, userId))
  if (existing.length === 0) return
  const ids = existing.map((row) => row.id)
  await db.delete(applicationEvent).where(inArray(applicationEvent.applicationId, ids))
  await db.delete(memberApplication).where(inArray(memberApplication.id, ids))
}

async function resetApplication(
  userId: string,
  status: 'pending' | 'approved',
): Promise<void> {
  await clearApplications(userId)

  const id = randomUUID()
  const paths = await writeDossier(userId)

  await db.insert(memberApplication).values({
    id,
    userId,
    cvPath: paths.cv,
    visionEssayPath: paths.vision,
    contributionEssayPath: paths.contribution,
    contributionPlan: PLAN,
    status,
  })

  await db.insert(applicationEvent).values({
    id: randomUUID(),
    applicationId: id,
    fromStatus: null,
    toStatus: status,
    actorId: userId,
  })
}

/**
 * Age a member's probation so the confirmation queue has something in it.
 *
 * Admitted seven months ago, so the manifesto's six months ran out a month ago.
 */
async function ensureProbationDue(userId: string): Promise<void> {
  const memberSince = new Date()
  memberSince.setMonth(memberSince.getMonth() - 7)
  const probationUntil = new Date(memberSince)
  probationUntil.setMonth(probationUntil.getMonth() + 6)

  await db
    .update(userTable)
    .set({ memberSince, probationUntil, probationConfirmedAt: null })
    .where(eq(userTable.id, userId))
}

/** A member whose six months are behind them, confirmed by the circle. */
async function confirmMember(userId: string): Promise<void> {
  const memberSince = new Date()
  memberSince.setMonth(memberSince.getMonth() - 12)
  const probationUntil = new Date(memberSince)
  probationUntil.setMonth(probationUntil.getMonth() + 6)

  await db
    .update(userTable)
    .set({ memberSince, probationUntil, probationConfirmedAt: probationUntil })
    .where(eq(userTable.id, userId))
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
  // Governance state is cleared wholesale: a previous run's nomination would
  // block a new one, and a spent invitation cannot be spent again.
  await db.delete(seniorPromotionVote)
  await db.delete(seniorPromotion)
  await db.delete(invitation)
  console.info('· cleared nominations and invitations')

  await resetApplication(ids.applicant, 'pending')
  console.info('· applicant has a pending application')

  // The newcomer must arrive with nothing on file: their test is the one that
  // actually submits the form, and the application it leaves behind would stop
  // the next run from reaching it.
  await clearApplications(ids.newcomer)
  console.info('· newcomer has no application on file')

  // The probationer is already admitted, so their application is approved and
  // their contribution plan is what the confirmation queue judges them against.
  await resetApplication(ids.probationer, 'approved')
  await ensureProbationDue(ids.probationer)
  console.info('· probationer is a member whose six months have elapsed')

  for (const key of ['confirmed', 'blockable'] as const) {
    await resetApplication(ids[key], 'approved')
  }
  await confirmMember(ids.confirmed)
  await confirmMember(ids.blockable)
  console.info('· confirmed and blockable are members past their probation')

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

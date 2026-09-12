import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../test/postgres'

let harness: TestDatabase
let enrollment: typeof import('./enrollment')
let schema: typeof import('./db/schema')

beforeAll(async () => {
  harness = await startTestDatabase()
  process.env.DATABASE_URL = harness.url
  enrollment = await import('./enrollment')
  schema = await import('./db/schema')
})

afterAll(async () => {
  await harness?.stop()
})

beforeEach(async () => {
  await harness.db.delete(schema.applicationEvent)
  await harness.db.delete(schema.memberApplication)
  await harness.db.delete(schema.user)
})

async function makeUser(overrides: Partial<typeof schema.user.$inferInsert> = {}) {
  const id = randomUUID()
  await harness.db.insert(schema.user).values({
    id,
    name: 'Lektè',
    email: `${id}@kle.ht`,
    emailVerified: true,
    role: 'reader',
    memberStatus: 'active',
    ...overrides,
  })
  return { id, role: 'reader', emailVerified: true, ...overrides } as {
    id: string
    role: string
    emailVerified: boolean
  }
}

const DOSSIER = {
  cvPath: 'a/cv.pdf',
  visionEssayPath: 'a/vision.pdf',
  contributionEssayPath: 'a/contribution.pdf',
  contributionPlan: 'x'.repeat(200),
}

describe('checkEligibility', () => {
  it('lets a verified reader apply', async () => {
    const user = await makeUser()
    await expect(enrollment.checkEligibility(user)).resolves.toEqual({ eligible: true })
  })

  it('refuses someone who is already a member', async () => {
    const user = await makeUser({ role: 'member' })
    await expect(enrollment.checkEligibility(user)).resolves.toEqual({
      eligible: false,
      reason: 'ALREADY_MEMBER',
    })
  })

  it('refuses an unverified address, since we could not report the outcome', async () => {
    const user = await makeUser({ emailVerified: false })
    await expect(enrollment.checkEligibility(user)).resolves.toEqual({
      eligible: false,
      reason: 'EMAIL_UNVERIFIED',
    })
  })

  it('refuses a second application while one is still open', async () => {
    const user = await makeUser()
    await enrollment.createApplication({ userId: user.id, ...DOSSIER })
    await expect(enrollment.checkEligibility(user)).resolves.toEqual({
      eligible: false,
      reason: 'APPLICATION_OPEN',
    })
  })

  /**
   * The bug this phase fixes. `user_id` used to carry a plain UNIQUE
   * constraint, so one rejection barred someone from the movement forever.
   */
  it('lets a previously rejected applicant try again', async () => {
    const user = await makeUser()
    const first = await enrollment.createApplication({ userId: user.id, ...DOSSIER })
    await harness.db
      .update(schema.memberApplication)
      .set({ status: 'rejected' })
      .where(eqId(first.id))

    await expect(enrollment.checkEligibility(user)).resolves.toEqual({ eligible: true })
    await expect(
      enrollment.createApplication({ userId: user.id, ...DOSSIER }),
    ).resolves.toHaveProperty('id')
  })

  it('keeps the history of both attempts', async () => {
    const user = await makeUser()
    const first = await enrollment.createApplication({ userId: user.id, ...DOSSIER })
    await harness.db
      .update(schema.memberApplication)
      .set({ status: 'rejected' })
      .where(eqId(first.id))
    await enrollment.createApplication({ userId: user.id, ...DOSSIER })

    const rows = await harness.db.select().from(schema.memberApplication)
    expect(rows).toHaveLength(2)
  })

  it.each(['pending', 'under_review', 'needs_more_info'] as const)(
    'treats %s as still open',
    async (status) => {
      const user = await makeUser()
      const app = await enrollment.createApplication({ userId: user.id, ...DOSSIER })
      await harness.db
        .update(schema.memberApplication)
        .set({ status })
        .where(eqId(app.id))
      await expect(enrollment.checkEligibility(user)).resolves.toMatchObject({
        eligible: false,
        reason: 'APPLICATION_OPEN',
      })
    },
  )
})

describe('createApplication', () => {
  it('records an opening event, so the trail starts at submission', async () => {
    const user = await makeUser()
    const { id } = await enrollment.createApplication({ userId: user.id, ...DOSSIER })
    const events = await harness.db.select().from(schema.applicationEvent)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      applicationId: id,
      fromStatus: null,
      toStatus: 'pending',
      actorId: user.id,
    })
  })

  it('stores the contribution plan the probation review will be measured against', async () => {
    const user = await makeUser()
    await enrollment.createApplication({ userId: user.id, ...DOSSIER })
    const [row] = await harness.db.select().from(schema.memberApplication)
    expect(row.contributionPlan).toHaveLength(200)
  })

  it('refuses a duplicate open application at the database level', async () => {
    // Belt and braces: checkEligibility guards the UI path, the partial unique
    // index guards against a race between two concurrent submissions.
    const user = await makeUser()
    await enrollment.createApplication({ userId: user.id, ...DOSSIER })
    await expect(
      enrollment.createApplication({ userId: user.id, ...DOSSIER }),
    ).rejects.toThrow()
  })

  it('writes nothing when the insert fails', async () => {
    const user = await makeUser()
    await enrollment.createApplication({ userId: user.id, ...DOSSIER })
    await expect(
      enrollment.createApplication({ userId: user.id, ...DOSSIER }),
    ).rejects.toThrow()
    // The transaction must have rolled back the event too.
    const events = await harness.db.select().from(schema.applicationEvent)
    expect(events).toHaveLength(1)
  })
})

function eqId(id: string) {
  return eq(schema.memberApplication.id, id)
}

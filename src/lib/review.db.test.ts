import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../test/postgres'

let harness: TestDatabase
let review: typeof import('./review')
let enrollment: typeof import('./enrollment')
let schema: typeof import('./db/schema')

beforeAll(async () => {
  harness = await startTestDatabase()
  process.env.DATABASE_URL = harness.url
  review = await import('./review')
  enrollment = await import('./enrollment')
  schema = await import('./db/schema')
})

afterAll(async () => {
  await harness?.stop()
})

beforeEach(async () => {
  await harness.db.delete(schema.accessEvent)
  await harness.db.delete(schema.roleChange)
  await harness.db.delete(schema.applicationEvent)
  await harness.db.delete(schema.memberApplication)
  await harness.db.delete(schema.user)
})

async function makeUser(role = 'reader') {
  const id = randomUUID()
  await harness.db.insert(schema.user).values({
    id,
    name: role,
    email: `${id}@kle.ht`,
    emailVerified: true,
    role: role as 'reader',
    memberStatus: 'active',
  })
  return id
}

const DOSSIER = {
  cvPath: 'a/cv.pdf',
  visionEssayPath: 'a/vision.pdf',
  contributionEssayPath: 'a/contribution.pdf',
  contributionPlan: 'x'.repeat(200),
}

async function applicationFor(userId: string) {
  const { id } = await enrollment.createApplication({ userId, ...DOSSIER })
  return id
}

const RATIONALE = 'Dossier complet et vision cohérente avec le manifeste.'

describe('listQueue', () => {
  it('returns open applications oldest first — a queue, not a stack', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const first = await applicationFor(a)
    await new Promise((r) => setTimeout(r, 10))
    const second = await applicationFor(b)

    const queue = await review.listQueue()
    expect(queue.map((q) => q.applicationId)).toEqual([first, second])
  })

  it('carries the applicant identity reviewers need', async () => {
    const applicant = await makeUser()
    await applicationFor(applicant)
    const [item] = await review.listQueue()
    expect(item.applicantId).toBe(applicant)
    expect(item.applicantEmail).toContain('@kle.ht')
  })

  it('drops an application once it has been decided', async () => {
    const applicant = await makeUser()
    const reviewer = await makeUser('senior_member')
    const app = await applicationFor(applicant)
    await review.decide({
      applicationId: app,
      decision: 'reject',
      rationale: RATIONALE,
      actorId: reviewer,
    })
    expect(await review.listQueue()).toHaveLength(0)
  })

  it('keeps an application that only needs more information', async () => {
    const applicant = await makeUser()
    const reviewer = await makeUser('senior_member')
    const app = await applicationFor(applicant)
    await review.decide({
      applicationId: app,
      decision: 'request_more_info',
      rationale: RATIONALE,
      actorId: reviewer,
    })
    expect(await review.listQueue()).toHaveLength(1)
  })
})

describe('decide — approval', () => {
  it('promotes the applicant to member', async () => {
    const applicant = await makeUser()
    const reviewer = await makeUser('senior_member')
    const app = await applicationFor(applicant)

    await review.decide({
      applicationId: app,
      decision: 'approve',
      rationale: RATIONALE,
      actorId: reviewer,
    })

    const [row] = await harness.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, applicant))
    expect(row.role).toBe('member')
  })

  it("starts the manifesto's six-month probation clock", async () => {
    const applicant = await makeUser()
    const reviewer = await makeUser('senior_member')
    const app = await applicationFor(applicant)

    await review.decide({
      applicationId: app,
      decision: 'approve',
      rationale: RATIONALE,
      actorId: reviewer,
    })

    const [row] = await harness.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, applicant))
    expect(row.memberSince).toBeInstanceOf(Date)
    const months =
      (row.probationUntil as Date).getMonth() - (row.memberSince as Date).getMonth()
    expect(((months % 12) + 12) % 12).toBe(review.PROBATION_MONTHS)
  })

  it('records who promoted them and why', async () => {
    const applicant = await makeUser()
    const reviewer = await makeUser('senior_member')
    const app = await applicationFor(applicant)

    await review.decide({
      applicationId: app,
      decision: 'approve',
      rationale: RATIONALE,
      actorId: reviewer,
    })

    const [change] = await harness.db.select().from(schema.roleChange)
    expect(change).toMatchObject({
      subjectUserId: applicant,
      fromRole: 'reader',
      toRole: 'member',
      reason: 'application_approved',
      actorId: reviewer,
    })
    expect(change.rationale).toBe(RATIONALE)
  })
})

describe('decide — refusals', () => {
  it('refuses a reviewer deciding their own application', async () => {
    // The manifesto assigns admission to a committee precisely so that it is
    // not one person's opinion about themselves.
    const person = await makeUser('senior_member')
    const app = await applicationFor(person)

    await expect(
      review.decide({
        applicationId: app,
        decision: 'approve',
        rationale: RATIONALE,
        actorId: person,
      }),
    ).resolves.toEqual({ ok: false, code: 'SELF_REVIEW' })
  })

  it('leaves no trace when it refuses self-review', async () => {
    const person = await makeUser('senior_member')
    const app = await applicationFor(person)
    await review.decide({
      applicationId: app,
      decision: 'approve',
      rationale: RATIONALE,
      actorId: person,
    })
    const [row] = await harness.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, person))
    expect(row.role).toBe('senior_member')
    expect(await harness.db.select().from(schema.roleChange)).toHaveLength(0)
  })

  it('requires a rationale that says something', async () => {
    const applicant = await makeUser()
    const reviewer = await makeUser('senior_member')
    const app = await applicationFor(applicant)

    await expect(
      review.decide({
        applicationId: app,
        decision: 'approve',
        rationale: 'ok',
        actorId: reviewer,
      }),
    ).resolves.toEqual({ ok: false, code: 'RATIONALE_REQUIRED' })
  })

  it('refuses to decide the same application twice', async () => {
    const applicant = await makeUser()
    const reviewer = await makeUser('senior_member')
    const app = await applicationFor(applicant)

    await review.decide({
      applicationId: app,
      decision: 'approve',
      rationale: RATIONALE,
      actorId: reviewer,
    })
    await expect(
      review.decide({
        applicationId: app,
        decision: 'reject',
        rationale: RATIONALE,
        actorId: reviewer,
      }),
    ).resolves.toEqual({ ok: false, code: 'ALREADY_DECIDED' })
  })

  it('reports a missing application rather than throwing', async () => {
    const reviewer = await makeUser('senior_member')
    await expect(
      review.decide({
        applicationId: randomUUID(),
        decision: 'approve',
        rationale: RATIONALE,
        actorId: reviewer,
      }),
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' })
  })
})

describe('audit trail', () => {
  it('records every status change with its reason', async () => {
    const applicant = await makeUser()
    const reviewer = await makeUser('senior_member')
    const app = await applicationFor(applicant)

    await review.decide({
      applicationId: app,
      decision: 'request_more_info',
      rationale: RATIONALE,
      actorId: reviewer,
    })
    await review.decide({
      applicationId: app,
      decision: 'approve',
      rationale: RATIONALE,
      actorId: reviewer,
    })

    const history = await review.getHistory(app)
    // Submission, then both decisions — newest first.
    expect(history.map((h) => h.toStatus)).toEqual([
      'approved',
      'needs_more_info',
      'pending',
    ])
  })

  it('lets a needs-more-info application be approved afterwards', async () => {
    const applicant = await makeUser()
    const reviewer = await makeUser('senior_member')
    const app = await applicationFor(applicant)

    await review.decide({
      applicationId: app,
      decision: 'request_more_info',
      rationale: RATIONALE,
      actorId: reviewer,
    })
    await expect(
      review.decide({
        applicationId: app,
        decision: 'approve',
        rationale: RATIONALE,
        actorId: reviewer,
      }),
    ).resolves.toEqual({ ok: true, status: 'approved' })
  })
})

/** Admit a fresh member and hand back everyone involved. */
async function admitMember() {
  const applicant = await makeUser()
  const reviewer = await makeUser('senior_member')
  const app = await applicationFor(applicant)
  await review.decide({
    applicationId: app,
    decision: 'approve',
    rationale: RATIONALE,
    actorId: reviewer,
  })
  return { applicant, reviewer, app }
}

/** A moment after the probation the manifesto gives a new member. */
function afterProbation(): Date {
  const later = new Date()
  later.setFullYear(later.getFullYear() + 1)
  return later
}

/** Move a member's probation into the past, as six months of waiting would. */
async function elapseProbation(userId: string) {
  const past = new Date()
  past.setFullYear(past.getFullYear() - 1)
  await harness.db
    .update(schema.user)
    .set({ probationUntil: past })
    .where(eq(schema.user.id, userId))
}

async function userRow(id: string) {
  const [row] = await harness.db.select().from(schema.user).where(eq(schema.user.id, id))
  return row
}

const PROBATION_RATIONALE =
  'A tenu son plan de contribution : trois notes de position et un cycle de lectures.'

describe('listProbationDue', () => {
  it('surfaces a member whose probation has elapsed', async () => {
    const { applicant } = await admitMember()
    const due = await review.listProbationDue(afterProbation())
    expect(due.map((d) => d.userId)).toContain(applicant)
  })

  it('leaves a member still inside their probation alone', async () => {
    await admitMember()
    expect(await review.listProbationDue(new Date())).toHaveLength(0)
  })

  it('carries the contribution plan the member is to be judged against', async () => {
    // A queue of names alone would invite a rubber stamp: the reviewer would
    // have nothing to check the member against.
    await admitMember()
    const [item] = await review.listProbationDue(afterProbation())
    expect(item.contributionPlan).toBe(DOSSIER.contributionPlan)
  })

  it('drops a member once their probation has been confirmed', async () => {
    const { applicant, reviewer } = await admitMember()
    await elapseProbation(applicant)
    await review.confirmProbation({
      userId: applicant,
      decision: 'confirm',
      rationale: PROBATION_RATIONALE,
      actorId: reviewer,
    })
    expect(await review.listProbationDue(afterProbation())).toHaveLength(0)
  })
})

describe('confirmProbation', () => {
  it('confirms the member and keeps their role', async () => {
    const { applicant, reviewer } = await admitMember()
    await elapseProbation(applicant)

    await expect(
      review.confirmProbation({
        userId: applicant,
        decision: 'confirm',
        rationale: PROBATION_RATIONALE,
        actorId: reviewer,
      }),
    ).resolves.toEqual({ ok: true, decision: 'confirm' })

    const row = await userRow(applicant)
    expect(row.role).toBe('member')
    expect(row.probationConfirmedAt).toBeInstanceOf(Date)
    // The end of probation is history, not something to erase on confirmation.
    expect(row.probationUntil).toBeInstanceOf(Date)
  })

  it('sends a member who did not keep their commitments back to reader', async () => {
    const { applicant, reviewer } = await admitMember()
    await elapseProbation(applicant)

    await expect(
      review.confirmProbation({
        userId: applicant,
        decision: 'revert',
        rationale: 'Aucune contribution depuis son admission malgre deux relances.',
        actorId: reviewer,
      }),
    ).resolves.toEqual({ ok: true, decision: 'revert' })

    const row = await userRow(applicant)
    expect(row.role).toBe('reader')
    expect(row.memberSince).toBeNull()
    expect(row.probationUntil).toBeNull()
  })

  it('records both outcomes in the audit trail with their reason', async () => {
    const { applicant, reviewer } = await admitMember()
    await elapseProbation(applicant)
    await review.confirmProbation({
      userId: applicant,
      decision: 'confirm',
      rationale: PROBATION_RATIONALE,
      actorId: reviewer,
    })

    const changes = await harness.db
      .select()
      .from(schema.roleChange)
      .where(eq(schema.roleChange.subjectUserId, applicant))
    expect(changes.map((c) => c.reason)).toContain('probation_confirmed')
    const confirmation = changes.find((c) => c.reason === 'probation_confirmed')
    expect(confirmation).toMatchObject({ toRole: 'member', actorId: reviewer })
    expect(confirmation?.rationale).toBe(PROBATION_RATIONALE)
  })

  it('refuses to close a probation before it has run its course', async () => {
    // The six months are the rule, not a target. A reviewer who could close a
    // probation early could admit someone outright in one click.
    const { applicant, reviewer } = await admitMember()
    await expect(
      review.confirmProbation({
        userId: applicant,
        decision: 'confirm',
        rationale: PROBATION_RATIONALE,
        actorId: reviewer,
      }),
    ).resolves.toEqual({ ok: false, code: 'TOO_EARLY' })

    expect((await userRow(applicant)).probationConfirmedAt).toBeNull()
  })

  it('requires a rationale that says something', async () => {
    const { applicant, reviewer } = await admitMember()
    await elapseProbation(applicant)
    await expect(
      review.confirmProbation({
        userId: applicant,
        decision: 'confirm',
        rationale: 'ok',
        actorId: reviewer,
      }),
    ).resolves.toEqual({ ok: false, code: 'RATIONALE_REQUIRED' })
  })

  it('refuses a member closing their own probation', async () => {
    const { applicant } = await admitMember()
    await elapseProbation(applicant)
    await expect(
      review.confirmProbation({
        userId: applicant,
        decision: 'confirm',
        rationale: PROBATION_RATIONALE,
        actorId: applicant,
      }),
    ).resolves.toEqual({ ok: false, code: 'SELF_REVIEW' })
  })

  it('refuses to decide the same probation twice', async () => {
    const { applicant, reviewer } = await admitMember()
    await elapseProbation(applicant)
    await review.confirmProbation({
      userId: applicant,
      decision: 'confirm',
      rationale: PROBATION_RATIONALE,
      actorId: reviewer,
    })
    await expect(
      review.confirmProbation({
        userId: applicant,
        decision: 'revert',
        rationale: PROBATION_RATIONALE,
        actorId: reviewer,
      }),
    ).resolves.toEqual({ ok: false, code: 'NOT_IN_PROBATION' })
  })

  it('refuses a subject who is not a probationary member at all', async () => {
    const reader = await makeUser()
    const reviewer = await makeUser('senior_member')
    await expect(
      review.confirmProbation({
        userId: reader,
        decision: 'confirm',
        rationale: PROBATION_RATIONALE,
        actorId: reviewer,
      }),
    ).resolves.toEqual({ ok: false, code: 'NOT_IN_PROBATION' })
  })

  it('reports a missing user rather than throwing', async () => {
    const reviewer = await makeUser('senior_member')
    await expect(
      review.confirmProbation({
        userId: randomUUID(),
        decision: 'confirm',
        rationale: PROBATION_RATIONALE,
        actorId: reviewer,
      }),
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' })
  })

  it('leaves no trace when it refuses', async () => {
    const { applicant, reviewer } = await admitMember()
    const before = await harness.db.select().from(schema.roleChange)
    await review.confirmProbation({
      userId: applicant,
      decision: 'confirm',
      rationale: PROBATION_RATIONALE,
      actorId: reviewer,
    })
    const after = await harness.db.select().from(schema.roleChange)
    expect(after).toHaveLength(before.length)
  })
})

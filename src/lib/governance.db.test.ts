import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../test/postgres'

let harness: TestDatabase
let moderation: typeof import('./moderation')
let promotion: typeof import('./promotion')
let invitationLib: typeof import('./invitation')
let schema: typeof import('./db/schema')

beforeAll(async () => {
  harness = await startTestDatabase()
  process.env.DATABASE_URL = harness.url
  moderation = await import('./moderation')
  promotion = await import('./promotion')
  invitationLib = await import('./invitation')
  schema = await import('./db/schema')
})

afterAll(async () => {
  await harness?.stop()
})

beforeEach(async () => {
  await harness.db.delete(schema.seniorPromotionVote)
  await harness.db.delete(schema.seniorPromotion)
  await harness.db.delete(schema.invitation)
  await harness.db.delete(schema.session)
  await harness.db.delete(schema.roleChange)
  await harness.db.delete(schema.user)
})

async function makeUser(
  role: 'reader' | 'member' | 'senior_member' | 'super_admin' = 'reader',
  overrides: Partial<{ probationConfirmedAt: Date | null; memberStatus: string }> = {},
) {
  const id = randomUUID()
  await harness.db.insert(schema.user).values({
    id,
    name: role,
    email: `${id}@kle.ht`,
    emailVerified: true,
    role,
    memberStatus: (overrides.memberStatus ?? 'active') as 'active',
    probationConfirmedAt: overrides.probationConfirmedAt ?? null,
  })
  return id
}

/** A member whose probation is behind them — the only kind that may be nominated. */
const confirmedMember = () => makeUser('member', { probationConfirmedAt: new Date() })

async function userRow(id: string) {
  const [row] = await harness.db.select().from(schema.user).where(eq(schema.user.id, id))
  return row
}

const REASON = 'Motif suffisamment long pour etre un motif.'

describe('blocking', () => {
  it('suspends the account and records who did it', async () => {
    const senior = await makeUser('senior_member')
    const subject = await makeUser('member')

    await expect(
      moderation.setBlocked({
        subjectUserId: subject,
        blocked: true,
        rationale: REASON,
        actor: { id: senior, role: 'senior_member' },
      }),
    ).resolves.toEqual({ ok: true, blocked: true })

    expect((await userRow(subject)).memberStatus).toBe('blocked')
    const [change] = await harness.db.select().from(schema.roleChange)
    expect(change).toMatchObject({ reason: 'blocked', actorId: senior })
    expect(change.rationale).toBe(REASON)
  })

  it('ends the sessions of the account it blocks', async () => {
    // Otherwise they keep whatever access they had until the cookie happens to
    // expire, which for misconduct serious enough to block is the window that
    // matters.
    const senior = await makeUser('senior_member')
    const subject = await makeUser('member')
    await harness.db.insert(schema.session).values({
      id: randomUUID(),
      token: randomUUID(),
      userId: subject,
      expiresAt: new Date(Date.now() + 86_400_000),
    })

    await moderation.setBlocked({
      subjectUserId: subject,
      blocked: true,
      rationale: REASON,
      actor: { id: senior, role: 'senior_member' },
    })

    const sessions = await harness.db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, subject))
    expect(sessions).toHaveLength(0)
  })

  it('leaves the role alone — a block suspends, it does not demote', async () => {
    const senior = await makeUser('senior_member')
    const subject = await makeUser('member')
    await moderation.setBlocked({
      subjectUserId: subject,
      blocked: true,
      rationale: REASON,
      actor: { id: senior, role: 'senior_member' },
    })
    expect((await userRow(subject)).role).toBe('member')
  })

  it('is reversible', async () => {
    const senior = await makeUser('senior_member')
    const subject = await makeUser('member')
    const actor = { id: senior, role: 'senior_member' as const }
    await moderation.setBlocked({
      subjectUserId: subject,
      blocked: true,
      rationale: REASON,
      actor,
    })
    await expect(
      moderation.setBlocked({
        subjectUserId: subject,
        blocked: false,
        rationale: REASON,
        actor,
      }),
    ).resolves.toEqual({ ok: true, blocked: false })
    expect((await userRow(subject)).memberStatus).toBe('active')
  })

  it('refuses a senior member blocking a peer', async () => {
    // One senior member who could block the others could neutralise the
    // admission committee on their own.
    const a = await makeUser('senior_member')
    const b = await makeUser('senior_member')
    await expect(
      moderation.setBlocked({
        subjectUserId: b,
        blocked: true,
        rationale: REASON,
        actor: { id: a, role: 'senior_member' },
      }),
    ).resolves.toEqual({ ok: false, code: 'RANK_TOO_HIGH' })
    expect((await userRow(b)).memberStatus).toBe('active')
  })

  it('lets a super admin block a senior member', async () => {
    const admin = await makeUser('super_admin')
    const senior = await makeUser('senior_member')
    await expect(
      moderation.setBlocked({
        subjectUserId: senior,
        blocked: true,
        rationale: REASON,
        actor: { id: admin, role: 'super_admin' },
      }),
    ).resolves.toEqual({ ok: true, blocked: true })
  })

  it('refuses blocking your own account', async () => {
    const senior = await makeUser('senior_member')
    await expect(
      moderation.setBlocked({
        subjectUserId: senior,
        blocked: true,
        rationale: REASON,
        actor: { id: senior, role: 'senior_member' },
      }),
    ).resolves.toEqual({ ok: false, code: 'SELF_TARGET' })
  })

  it('requires a written reason', async () => {
    const senior = await makeUser('senior_member')
    const subject = await makeUser('member')
    await expect(
      moderation.setBlocked({
        subjectUserId: subject,
        blocked: true,
        rationale: 'non',
        actor: { id: senior, role: 'senior_member' },
      }),
    ).resolves.toEqual({ ok: false, code: 'RATIONALE_REQUIRED' })
  })

  it('refuses to block an account that is already blocked', async () => {
    const senior = await makeUser('senior_member')
    const subject = await makeUser('member', { memberStatus: 'blocked' })
    await expect(
      moderation.setBlocked({
        subjectUserId: subject,
        blocked: true,
        rationale: REASON,
        actor: { id: senior, role: 'senior_member' },
      }),
    ).resolves.toEqual({ ok: false, code: 'ALREADY_IN_STATE' })
  })
})

describe('nomination', () => {
  it('opens against a confirmed member', async () => {
    const senior = await makeUser('senior_member')
    const subject = await confirmedMember()
    const result = await promotion.nominate({
      subjectUserId: subject,
      rationale: REASON,
      actorId: senior,
    })
    expect(result.ok).toBe(true)
  })

  it('refuses a member still inside their probation', async () => {
    // Promoting them would skip the very check the probation exists for.
    const senior = await makeUser('senior_member')
    const subject = await makeUser('member')
    await expect(
      promotion.nominate({ subjectUserId: subject, rationale: REASON, actorId: senior }),
    ).resolves.toEqual({ ok: false, code: 'NOT_ELIGIBLE' })
  })

  it('refuses a reader', async () => {
    const senior = await makeUser('senior_member')
    const subject = await makeUser('reader')
    await expect(
      promotion.nominate({ subjectUserId: subject, rationale: REASON, actorId: senior }),
    ).resolves.toEqual({ ok: false, code: 'NOT_ELIGIBLE' })
  })

  it('refuses a blocked member', async () => {
    const senior = await makeUser('senior_member')
    const subject = await makeUser('member', {
      probationConfirmedAt: new Date(),
      memberStatus: 'blocked',
    })
    await expect(
      promotion.nominate({ subjectUserId: subject, rationale: REASON, actorId: senior }),
    ).resolves.toEqual({ ok: false, code: 'NOT_ELIGIBLE' })
  })

  it('refuses nominating yourself', async () => {
    const senior = await makeUser('senior_member')
    await expect(
      promotion.nominate({ subjectUserId: senior, rationale: REASON, actorId: senior }),
    ).resolves.toEqual({ ok: false, code: 'SELF_NOMINATION' })
  })

  it('refuses a second open nomination for the same person', async () => {
    const a = await makeUser('senior_member')
    const b = await makeUser('senior_member')
    const subject = await confirmedMember()
    await promotion.nominate({ subjectUserId: subject, rationale: REASON, actorId: a })
    await expect(
      promotion.nominate({ subjectUserId: subject, rationale: REASON, actorId: b }),
    ).resolves.toEqual({ ok: false, code: 'ALREADY_OPEN' })
  })
})

describe('voting', () => {
  async function openNomination(seniorCount: number) {
    const seniors: Array<string> = []
    for (let i = 0; i < seniorCount; i += 1) seniors.push(await makeUser('senior_member'))
    const subject = await confirmedMember()
    const result = await promotion.nominate({
      subjectUserId: subject,
      rationale: REASON,
      actorId: seniors[0],
    })
    if (!result.ok) throw new Error(result.code)
    return { seniors, subject, promotionId: result.promotionId }
  }

  it('promotes once the qualified majority is reached', async () => {
    const { seniors, subject, promotionId } = await openNomination(3)
    for (const voter of seniors.slice(0, 2)) {
      const partial = await promotion.castVote({
        promotionId,
        vote: 'approve',
        rationale: REASON,
        voterId: voter,
      })
      expect(partial).toMatchObject({ ok: true, outcome: 'open' })
    }

    const final = await promotion.castVote({
      promotionId,
      vote: 'approve',
      rationale: REASON,
      voterId: seniors[2],
    })
    expect(final).toMatchObject({ ok: true, outcome: 'approved' })
    expect((await userRow(subject)).role).toBe('senior_member')
  })

  it('records the promotion without crediting the last voter', async () => {
    // The circle promoted them, not whoever happened to vote last. An actor on
    // that row would read as one person having made the decision.
    const { seniors, subject, promotionId } = await openNomination(3)
    for (const voter of seniors) {
      await promotion.castVote({
        promotionId,
        vote: 'approve',
        rationale: REASON,
        voterId: voter,
      })
    }
    const [change] = await harness.db
      .select()
      .from(schema.roleChange)
      .where(eq(schema.roleChange.subjectUserId, subject))
    expect(change).toMatchObject({
      toRole: 'senior_member',
      reason: 'promoted',
      actorId: null,
    })
    expect(change.rationale).toContain('3/3')
  })

  it('does not promote on a bare majority', async () => {
    // Three for, two against, in a circle of nine. A simple majority, and the
    // vote stays open — this is the case the qualified majority exists for.
    const { seniors, subject, promotionId } = await openNomination(9)
    for (const voter of seniors.slice(0, 2)) {
      await promotion.castVote({
        promotionId,
        vote: 'reject',
        rationale: REASON,
        voterId: voter,
      })
    }
    let result: Awaited<ReturnType<typeof promotion.castVote>> | undefined
    for (const voter of seniors.slice(2, 5)) {
      result = await promotion.castVote({
        promotionId,
        vote: 'approve',
        rationale: REASON,
        voterId: voter,
      })
    }
    expect(result).toMatchObject({ ok: true, outcome: 'open' })
    expect((await userRow(subject)).role).toBe('member')
  })

  it('closes as rejected once approval is impossible', async () => {
    // Two of five against: even unanimous support from the other three gives
    // 3 of 5, short of two thirds, so there is nothing left to wait for.
    const { seniors, subject, promotionId } = await openNomination(5)
    await promotion.castVote({
      promotionId,
      vote: 'reject',
      rationale: REASON,
      voterId: seniors[0],
    })
    const result = await promotion.castVote({
      promotionId,
      vote: 'reject',
      rationale: REASON,
      voterId: seniors[1],
    })
    expect(result).toMatchObject({ ok: true, outcome: 'rejected' })
    expect((await userRow(subject)).role).toBe('member')
  })

  it('a single objection closes a vote in a circle of exactly three', async () => {
    // Three approvals are required, and there are only three voters, so every
    // one of them has to agree. Worth pinning: it is the smallest circle in
    // which a promotion is possible at all.
    const { seniors, promotionId } = await openNomination(3)
    const result = await promotion.castVote({
      promotionId,
      vote: 'reject',
      rationale: REASON,
      voterId: seniors[0],
    })
    expect(result).toMatchObject({ ok: true, outcome: 'rejected' })
  })

  it('refuses a second vote from the same member', async () => {
    const { seniors, promotionId } = await openNomination(5)
    await promotion.castVote({
      promotionId,
      vote: 'approve',
      rationale: REASON,
      voterId: seniors[0],
    })
    await expect(
      promotion.castVote({
        promotionId,
        vote: 'reject',
        rationale: REASON,
        voterId: seniors[0],
      }),
    ).resolves.toEqual({ ok: false, code: 'ALREADY_VOTED' })
  })

  it('refuses the subject voting on their own promotion', async () => {
    const { subject, promotionId } = await openNomination(5)
    await expect(
      promotion.castVote({
        promotionId,
        vote: 'approve',
        rationale: REASON,
        voterId: subject,
      }),
    ).resolves.toEqual({ ok: false, code: 'SELF_VOTE' })
  })

  it('refuses a vote on a closed nomination', async () => {
    const { seniors, promotionId } = await openNomination(3)
    for (const voter of seniors) {
      await promotion.castVote({
        promotionId,
        vote: 'approve',
        rationale: REASON,
        voterId: voter,
      })
    }
    const extra = await makeUser('senior_member')
    await expect(
      promotion.castVote({
        promotionId,
        vote: 'reject',
        rationale: REASON,
        voterId: extra,
      }),
    ).resolves.toEqual({ ok: false, code: 'ALREADY_CLOSED' })
  })

  it('requires a written reason for every vote', async () => {
    const { seniors, promotionId } = await openNomination(3)
    await expect(
      promotion.castVote({
        promotionId,
        vote: 'approve',
        rationale: 'oui',
        voterId: seniors[0],
      }),
    ).resolves.toEqual({ ok: false, code: 'RATIONALE_REQUIRED' })
  })

  it('keeps every vote attributable', async () => {
    const { seniors, promotionId } = await openNomination(3)
    await promotion.castVote({
      promotionId,
      vote: 'approve',
      rationale: REASON,
      voterId: seniors[0],
    })
    const votes = await promotion.getVotes(promotionId)
    expect(votes).toHaveLength(1)
    expect(votes[0].voterEmail).toContain('@kle.ht')
    expect(votes[0].rationale).toBe(REASON)
  })
})

describe('invitations', () => {
  it('stores a hash, never the token', async () => {
    const senior = await makeUser('senior_member')
    const result = await invitationLib.issueInvitation({
      email: 'nouvo@kle.ht',
      note: REASON,
      actorId: senior,
    })
    if (!result.ok) throw new Error(result.code)

    const [row] = await harness.db.select().from(schema.invitation)
    expect(row.tokenHash).not.toBe(result.token)
    expect(row.tokenHash).toBe(invitationLib.hashToken(result.token))
    // A leaked backup must not be a set of working membership grants.
    expect(JSON.stringify(row)).not.toContain(result.token)
  })

  it('accepts a fresh token', async () => {
    const senior = await makeUser('senior_member')
    const issued = await invitationLib.issueInvitation({
      email: 'nouvo@kle.ht',
      note: REASON,
      actorId: senior,
    })
    if (!issued.ok) throw new Error(issued.code)
    const checked = await invitationLib.checkInvitation(issued.token)
    expect(checked.ok).toBe(true)
  })

  it('refuses a token that does not exist', async () => {
    await expect(invitationLib.checkInvitation('not-a-token')).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    })
  })

  it('refuses an expired token', async () => {
    const senior = await makeUser('senior_member')
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const issued = await invitationLib.issueInvitation({
      email: 'nouvo@kle.ht',
      note: REASON,
      actorId: senior,
      now: longAgo,
    })
    if (!issued.ok) throw new Error(issued.code)
    await expect(invitationLib.checkInvitation(issued.token)).resolves.toEqual({
      ok: false,
      code: 'EXPIRED',
    })
  })

  it('refuses a withdrawn token', async () => {
    const senior = await makeUser('senior_member')
    const issued = await invitationLib.issueInvitation({
      email: 'nouvo@kle.ht',
      note: REASON,
      actorId: senior,
    })
    if (!issued.ok) throw new Error(issued.code)
    await invitationLib.revokeInvitation({ invitationId: issued.id })
    await expect(invitationLib.checkInvitation(issued.token)).resolves.toEqual({
      ok: false,
      code: 'REVOKED',
    })
  })

  it('can only be spent once', async () => {
    // Two people opening the same link at once must not both get an account.
    const senior = await makeUser('senior_member')
    const first = await makeUser('reader')
    const second = await makeUser('reader')
    const issued = await invitationLib.issueInvitation({
      email: 'nouvo@kle.ht',
      note: REASON,
      actorId: senior,
    })
    if (!issued.ok) throw new Error(issued.code)

    const now = new Date()
    const claimedFirst = await harness.db.transaction((tx) =>
      invitationLib.consumeInvitation(tx, {
        invitationId: issued.id,
        userId: first,
        now,
      }),
    )
    const claimedSecond = await harness.db.transaction((tx) =>
      invitationLib.consumeInvitation(tx, {
        invitationId: issued.id,
        userId: second,
        now,
      }),
    )
    expect(claimedFirst).toBe(true)
    expect(claimedSecond).toBe(false)
  })

  it('refuses an address that already has an account', async () => {
    const senior = await makeUser('senior_member')
    const existing = await makeUser('reader')
    const [row] = await harness.db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, existing))
    await expect(
      invitationLib.issueInvitation({ email: row.email, note: REASON, actorId: senior }),
    ).resolves.toEqual({ ok: false, code: 'EMAIL_TAKEN' })
  })

  it('requires the sponsor to say why', async () => {
    const senior = await makeUser('senior_member')
    await expect(
      invitationLib.issueInvitation({
        email: 'nouvo@kle.ht',
        note: 'ok',
        actorId: senior,
      }),
    ).resolves.toEqual({ ok: false, code: 'NOTE_REQUIRED' })
  })

  it('refuses withdrawing one that has already been spent', async () => {
    const senior = await makeUser('senior_member')
    const newcomer = await makeUser('reader')
    const issued = await invitationLib.issueInvitation({
      email: 'nouvo@kle.ht',
      note: REASON,
      actorId: senior,
    })
    if (!issued.ok) throw new Error(issued.code)
    await harness.db.transaction((tx) =>
      invitationLib.consumeInvitation(tx, {
        invitationId: issued.id,
        userId: newcomer,
        now: new Date(),
      }),
    )
    await expect(
      invitationLib.revokeInvitation({ invitationId: issued.id }),
    ).resolves.toEqual({ ok: false, code: 'ALREADY_USED' })
  })
})

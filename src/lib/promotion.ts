import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, inArray, ne } from 'drizzle-orm'
import {
  type PromotionStatus,
  type PromotionVote,
  type Role,
  roleChange,
  seniorPromotion,
  seniorPromotionVote,
  user,
} from './db/schema'

/** A written reason, long enough to actually be one. */
export const MIN_RATIONALE_CHARS = 20

/**
 * The qualified majority.
 *
 * The manifesto rejects simple majority for consequential decisions, and a
 * senior member can read every applicant's dossier and decide who joins the
 * movement. Three approvals stops two friends from promoting each other; two
 * thirds stops a bare majority from carrying it.
 */
export const MIN_APPROVALS = 3
export const APPROVAL_NUMERATOR = 2
export const APPROVAL_DENOMINATOR = 3

export type Tally = {
  approvals: number
  rejections: number
  /** Senior members entitled to vote, the subject excluded. */
  electorate: number
}

export type Outcome = 'open' | 'approved' | 'rejected'

/**
 * Read the outcome off the tally.
 *
 * Approved once three members have approved *and* approvals are at least two
 * thirds of the votes cast. Note the denominator: votes cast, not the whole
 * electorate, so someone who does not vote neither helps nor blocks.
 *
 * Rejected only once approval has become arithmetically impossible — that is,
 * when it would still fail even if every senior member who has not voted yet
 * approved. Waiting for that moment rather than guessing earlier means a
 * nomination is never closed against someone who could still have carried it,
 * and never left hanging over them once they cannot.
 *
 * Kept pure so the arithmetic can be tested on its own. It is the rule the whole
 * flow exists to enforce, and the easiest part to get quietly wrong.
 */
export function evaluate(tally: Tally): Outcome {
  const cast = tally.approvals + tally.rejections

  if (
    tally.approvals >= MIN_APPROVALS &&
    tally.approvals * APPROVAL_DENOMINATOR >= cast * APPROVAL_NUMERATOR
  ) {
    return 'approved'
  }

  // The best case still available: everyone yet to vote approves.
  const stillToVote = Math.max(0, tally.electorate - cast)
  const bestApprovals = tally.approvals + stillToVote
  const bestCast = cast + stillToVote

  if (bestApprovals < MIN_APPROVALS) return 'rejected'
  if (bestApprovals * APPROVAL_DENOMINATOR < bestCast * APPROVAL_NUMERATOR) {
    return 'rejected'
  }

  return 'open'
}

export type PromotionError =
  | 'NOT_FOUND'
  | 'NOT_ELIGIBLE'
  | 'ALREADY_OPEN'
  | 'ALREADY_CLOSED'
  | 'SELF_NOMINATION'
  | 'SELF_VOTE'
  | 'ALREADY_VOTED'
  | 'RATIONALE_REQUIRED'

export type NominateResult =
  | { ok: true; promotionId: string }
  | { ok: false; code: PromotionError }
export type VoteResult =
  | { ok: true; outcome: Outcome; tally: Tally }
  | { ok: false; code: PromotionError }

/** Senior members who may vote, excluding the person being voted on. */
async function electorateSize(subjectUserId: string): Promise<number> {
  const { db } = await import('./db')
  const [row] = await db
    .select({ n: count() })
    .from(user)
    .where(
      and(
        inArray(user.role, ['senior_member', 'super_admin'] as Array<Role>),
        ne(user.id, subjectUserId),
        eq(user.memberStatus, 'active'),
      ),
    )
  return row?.n ?? 0
}

/**
 * Open a nomination.
 *
 * Only a confirmed member may be nominated: someone still inside their six
 * months has not yet been evaluated against the commitments they made, and
 * promoting them would skip the very check the probation exists for.
 */
export async function nominate(input: {
  subjectUserId: string
  rationale: string
  actorId: string
}): Promise<NominateResult> {
  const rationale = input.rationale.trim()
  if (rationale.length < MIN_RATIONALE_CHARS) {
    return { ok: false, code: 'RATIONALE_REQUIRED' }
  }
  if (input.subjectUserId === input.actorId) {
    return { ok: false, code: 'SELF_NOMINATION' }
  }

  const { db } = await import('./db')
  const [subject] = await db
    .select({
      id: user.id,
      role: user.role,
      memberStatus: user.memberStatus,
      probationConfirmedAt: user.probationConfirmedAt,
    })
    .from(user)
    .where(eq(user.id, input.subjectUserId))
    .limit(1)

  if (!subject) return { ok: false, code: 'NOT_FOUND' }
  if (
    subject.role !== 'member' ||
    subject.memberStatus !== 'active' ||
    !subject.probationConfirmedAt
  ) {
    return { ok: false, code: 'NOT_ELIGIBLE' }
  }

  const [open] = await db
    .select({ id: seniorPromotion.id })
    .from(seniorPromotion)
    .where(
      and(
        eq(seniorPromotion.subjectUserId, subject.id),
        eq(seniorPromotion.status, 'open'),
      ),
    )
    .limit(1)
  if (open) return { ok: false, code: 'ALREADY_OPEN' }

  const id = randomUUID()
  try {
    await db.insert(seniorPromotion).values({
      id,
      subjectUserId: subject.id,
      openedBy: input.actorId,
      rationale,
    })
  } catch {
    // Two senior members nominating the same person at once: the partial unique
    // index is what actually decides, and the loser gets the same answer as if
    // they had checked a moment later.
    return { ok: false, code: 'ALREADY_OPEN' }
  }
  return { ok: true, promotionId: id }
}

/**
 * Cast one vote and, if the tally now decides it, close the nomination.
 *
 * The vote, the recount and the promotion all happen in one transaction. A vote
 * recorded without its consequence — or a promotion with no vote behind it —
 * would leave the roster and the record disagreeing about why somebody can read
 * every dossier in the movement.
 */
export async function castVote(input: {
  promotionId: string
  vote: PromotionVote
  rationale: string
  voterId: string
}): Promise<VoteResult> {
  const rationale = input.rationale.trim()
  if (rationale.length < MIN_RATIONALE_CHARS) {
    return { ok: false, code: 'RATIONALE_REQUIRED' }
  }

  const { db } = await import('./db')
  const [promotion] = await db
    .select()
    .from(seniorPromotion)
    .where(eq(seniorPromotion.id, input.promotionId))
    .limit(1)

  if (!promotion) return { ok: false, code: 'NOT_FOUND' }
  if (promotion.status !== 'open') return { ok: false, code: 'ALREADY_CLOSED' }
  if (promotion.subjectUserId === input.voterId) return { ok: false, code: 'SELF_VOTE' }

  const [existing] = await db
    .select({ id: seniorPromotionVote.id })
    .from(seniorPromotionVote)
    .where(
      and(
        eq(seniorPromotionVote.promotionId, promotion.id),
        eq(seniorPromotionVote.voterId, input.voterId),
      ),
    )
    .limit(1)
  if (existing) return { ok: false, code: 'ALREADY_VOTED' }

  const electorate = await electorateSize(promotion.subjectUserId)
  const now = new Date()

  return db.transaction(async (tx) => {
    await tx.insert(seniorPromotionVote).values({
      id: randomUUID(),
      promotionId: promotion.id,
      voterId: input.voterId,
      vote: input.vote,
      rationale,
    })

    const votes = await tx
      .select({ vote: seniorPromotionVote.vote })
      .from(seniorPromotionVote)
      .where(eq(seniorPromotionVote.promotionId, promotion.id))

    const tally: Tally = {
      approvals: votes.filter((v) => v.vote === 'approve').length,
      rejections: votes.filter((v) => v.vote === 'reject').length,
      electorate,
    }
    const outcome = evaluate(tally)
    if (outcome === 'open') return { ok: true as const, outcome, tally }

    await tx
      .update(seniorPromotion)
      .set({ status: outcome as PromotionStatus, closedAt: now })
      .where(eq(seniorPromotion.id, promotion.id))

    if (outcome === 'approved') {
      await tx
        .update(user)
        .set({ role: 'senior_member', updatedAt: now })
        .where(eq(user.id, promotion.subjectUserId))

      await tx.insert(roleChange).values({
        id: randomUUID(),
        subjectUserId: promotion.subjectUserId,
        fromRole: 'member',
        toRole: 'senior_member',
        reason: 'promoted',
        // The individual votes are the real record; this line says where to
        // find them, so the audit log alone never implies one person decided.
        rationale: `${tally.approvals}/${tally.approvals + tally.rejections} — ${promotion.rationale}`,
        // Null on purpose: the circle promoted them, not the last voter.
        actorId: null,
      })
    }

    return { ok: true as const, outcome, tally }
  })
}

/** Withdraw a nomination that should not have been opened. */
export async function withdraw(input: {
  promotionId: string
  actorId: string
}): Promise<{ ok: true } | { ok: false; code: PromotionError }> {
  const { db } = await import('./db')
  const [promotion] = await db
    .select({ id: seniorPromotion.id, status: seniorPromotion.status })
    .from(seniorPromotion)
    .where(eq(seniorPromotion.id, input.promotionId))
    .limit(1)

  if (!promotion) return { ok: false, code: 'NOT_FOUND' }
  if (promotion.status !== 'open') return { ok: false, code: 'ALREADY_CLOSED' }

  await db
    .update(seniorPromotion)
    .set({ status: 'withdrawn', closedAt: new Date() })
    .where(eq(seniorPromotion.id, promotion.id))
  return { ok: true }
}

export type OpenNomination = {
  promotionId: string
  subjectUserId: string
  subjectName: string
  subjectEmail: string
  rationale: string
  openedAt: Date
  tally: Tally
  myVote: PromotionVote | null
}

/** Nominations still open, with the tally and whether the reader has voted. */
export async function listOpenNominations(
  viewerId: string,
): Promise<Array<OpenNomination>> {
  const { db } = await import('./db')
  const rows = await db
    .select({
      promotionId: seniorPromotion.id,
      subjectUserId: seniorPromotion.subjectUserId,
      subjectName: user.name,
      subjectEmail: user.email,
      rationale: seniorPromotion.rationale,
      openedAt: seniorPromotion.createdAt,
    })
    .from(seniorPromotion)
    .innerJoin(user, eq(user.id, seniorPromotion.subjectUserId))
    .where(eq(seniorPromotion.status, 'open'))
    .orderBy(desc(seniorPromotion.createdAt))

  return Promise.all(
    rows.map(async (row) => {
      const votes = await db
        .select({ vote: seniorPromotionVote.vote, voterId: seniorPromotionVote.voterId })
        .from(seniorPromotionVote)
        .where(eq(seniorPromotionVote.promotionId, row.promotionId))

      return {
        ...row,
        tally: {
          approvals: votes.filter((v) => v.vote === 'approve').length,
          rejections: votes.filter((v) => v.vote === 'reject').length,
          electorate: await electorateSize(row.subjectUserId),
        },
        myVote: votes.find((v) => v.voterId === viewerId)?.vote ?? null,
      }
    }),
  )
}

/** Every vote on one nomination, named. Votes here are attributable by design. */
export async function getVotes(promotionId: string) {
  const { db } = await import('./db')
  return db
    .select({
      vote: seniorPromotionVote.vote,
      rationale: seniorPromotionVote.rationale,
      createdAt: seniorPromotionVote.createdAt,
      voterName: user.name,
      voterEmail: user.email,
    })
    .from(seniorPromotionVote)
    .innerJoin(user, eq(user.id, seniorPromotionVote.voterId))
    .where(eq(seniorPromotionVote.promotionId, promotionId))
    .orderBy(seniorPromotionVote.createdAt)
}

export type { PromotionStatus }

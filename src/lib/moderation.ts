import { randomUUID } from 'node:crypto'
import { eq, ne } from 'drizzle-orm'
import {
  hasAtLeastRole,
  ROLE_RANK,
  type Role,
  roleChange,
  session,
  user,
} from './db/schema'

/** A written reason, long enough to actually be one. */
export const MIN_RATIONALE_CHARS = 20

export type ModerationError =
  | 'NOT_FOUND'
  | 'SELF_TARGET'
  | 'RANK_TOO_HIGH'
  | 'ALREADY_IN_STATE'
  | 'RATIONALE_REQUIRED'

export type ModerationResult =
  | { ok: true; blocked: boolean }
  | { ok: false; code: ModerationError }

/**
 * Whether `actor` may block or unblock `subject`.
 *
 * Only downwards. A senior member who could block their peers could neutralise
 * the admission committee on their own, and the manifesto puts consequential
 * decisions in more than one pair of hands. Removing a senior member is a
 * decision for a super admin, and no one may act on their own account.
 */
export function canModerate(
  actor: { id: string; role: Role },
  subject: { id: string; role: Role },
) {
  if (actor.id === subject.id) return { ok: false, code: 'SELF_TARGET' } as const
  if (!hasAtLeastRole(actor.role, 'senior_member')) {
    return { ok: false, code: 'RANK_TOO_HIGH' } as const
  }
  if (ROLE_RANK[subject.role] >= ROLE_RANK[actor.role]) {
    return { ok: false, code: 'RANK_TOO_HIGH' } as const
  }
  return { ok: true } as const
}

/**
 * Block or unblock an account, with a written reason.
 *
 * Blocking ends the person's sessions in the same transaction as the status
 * change. Without that they keep whatever access they had until their cookie
 * happens to expire, which for misconduct serious enough to block is the whole
 * window that matters.
 *
 * Reversible on purpose: the manifesto's answer to a bad decision is that it
 * can be seen and undone, not that it is never made.
 */
export async function setBlocked(input: {
  subjectUserId: string
  blocked: boolean
  rationale: string
  actor: { id: string; role: Role }
}): Promise<ModerationResult> {
  const rationale = input.rationale.trim()
  if (rationale.length < MIN_RATIONALE_CHARS) {
    return { ok: false, code: 'RATIONALE_REQUIRED' }
  }

  const { db } = await import('./db')
  const [subject] = await db
    .select({ id: user.id, role: user.role, memberStatus: user.memberStatus })
    .from(user)
    .where(eq(user.id, input.subjectUserId))
    .limit(1)

  if (!subject) return { ok: false, code: 'NOT_FOUND' }

  const permitted = canModerate(input.actor, subject)
  if (!permitted.ok) return { ok: false, code: permitted.code }

  const alreadyBlocked = subject.memberStatus === 'blocked'
  if (alreadyBlocked === input.blocked) return { ok: false, code: 'ALREADY_IN_STATE' }

  const now = new Date()

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ memberStatus: input.blocked ? 'blocked' : 'active', updatedAt: now })
      .where(eq(user.id, subject.id))

    if (input.blocked) {
      await tx.delete(session).where(eq(session.userId, subject.id))
    }

    await tx.insert(roleChange).values({
      id: randomUUID(),
      subjectUserId: subject.id,
      // The role is untouched: blocking suspends access, it does not demote.
      // Recording it in `role_change` anyway keeps one chronological account of
      // everything that ever changed what a person may do.
      fromRole: subject.role,
      toRole: subject.role,
      reason: input.blocked ? 'blocked' : 'unblocked',
      rationale,
      actorId: input.actor.id,
    })
  })

  return { ok: true, blocked: input.blocked }
}

export type RosterEntry = {
  id: string
  name: string
  email: string
  role: Role
  memberStatus: string
  probationUntil: Date | null
  probationConfirmedAt: Date | null
}

/**
 * Everyone the moderator could act on, excluding themselves.
 *
 * Blocked accounts stay on the list. A blocked person who cannot be found is a
 * person who cannot be unblocked.
 */
export async function listRoster(actorId: string): Promise<Array<RosterEntry>> {
  const { db } = await import('./db')
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      memberStatus: user.memberStatus,
      probationUntil: user.probationUntil,
      probationConfirmedAt: user.probationConfirmedAt,
    })
    .from(user)
    .where(ne(user.id, actorId))
    .orderBy(user.email)
  return rows as Array<RosterEntry>
}

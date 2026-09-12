import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
// Type-only: erased at compile time, so this does not pull the driver in.
import type { db as Database } from './db'
import { invitation, user } from './db/schema'

/** The transaction handle drizzle hands to `db.transaction(tx => …)`. */
type Tx = Parameters<Parameters<typeof Database.transaction>[0]>[0]

/** A sponsor's note about why this person, long enough to be a reason. */
export const MIN_NOTE_CHARS = 20

/**
 * How long an invitation stays usable.
 *
 * Short on purpose. An invitation is a standing grant of membership in someone
 * else's name; one left in an old inbox for a year is a liability, and the
 * sponsor can always issue another.
 */
export const INVITATION_DAYS = 7

/**
 * Hash a token for storage.
 *
 * SHA-256 with no salt, deliberately: the token is 32 bytes of CSPRNG output,
 * so there is no dictionary to attack and nothing a salt would defend against.
 * What matters is that the stored value cannot be replayed as a link.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export type InvitationError =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'ALREADY_USED'
  | 'REVOKED'
  | 'EMAIL_TAKEN'
  | 'NOTE_REQUIRED'
  | 'INVALID_EMAIL'

export type IssueResult =
  | { ok: true; id: string; token: string; email: string; expiresAt: Date }
  | { ok: false; code: InvitationError }

/**
 * Issue an invitation to someone the sponsor knows.
 *
 * The raw token is returned exactly once, for the link. Nothing stores it, so
 * an invitation that is never delivered cannot be recovered — only reissued.
 */
export async function issueInvitation(input: {
  email: string
  note: string
  actorId: string
  now?: Date
}): Promise<IssueResult> {
  const email = input.email.trim().toLowerCase()
  const note = input.note.trim()
  const { EMAIL_RE } = await import('./validation')
  if (!EMAIL_RE.test(email)) return { ok: false, code: 'INVALID_EMAIL' }
  if (note.length < MIN_NOTE_CHARS) return { ok: false, code: 'NOTE_REQUIRED' }

  const { db } = await import('./db')
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  if (existing) return { ok: false, code: 'EMAIL_TAKEN' }

  const token = randomBytes(32).toString('base64url')
  const now = input.now ?? new Date()
  const expiresAt = new Date(now.getTime() + INVITATION_DAYS * 24 * 60 * 60 * 1000)
  const id = randomUUID()

  await db.insert(invitation).values({
    id,
    tokenHash: hashToken(token),
    email,
    invitedBy: input.actorId,
    note,
    expiresAt,
  })

  return { ok: true, id, token, email, expiresAt }
}

export type ValidInvitation = {
  id: string
  email: string
  invitedBy: string | null
  note: string
}

/**
 * Look up an invitation by its raw token and say whether it may still be used.
 *
 * The refusals are distinguished — expired, already used, withdrawn — because
 * the person holding the link needs to know which one applies before they ask
 * their sponsor for another.
 */
export async function checkInvitation(
  token: string,
  now: Date = new Date(),
): Promise<
  { ok: true; invitation: ValidInvitation } | { ok: false; code: InvitationError }
> {
  if (!token) return { ok: false, code: 'NOT_FOUND' }
  const { db } = await import('./db')
  const [row] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.tokenHash, hashToken(token)))
    .limit(1)

  if (!row) return { ok: false, code: 'NOT_FOUND' }
  if (row.revokedAt) return { ok: false, code: 'REVOKED' }
  if (row.usedAt) return { ok: false, code: 'ALREADY_USED' }
  if (row.expiresAt <= now) return { ok: false, code: 'EXPIRED' }

  return {
    ok: true,
    invitation: {
      id: row.id,
      email: row.email,
      invitedBy: row.invitedBy,
      note: row.note,
    },
  }
}

/**
 * Mark an invitation spent, inside the caller's transaction.
 *
 * The update is conditional on it still being unused, so two people opening the
 * same link at once cannot both get an account: the second update matches no
 * rows and the caller rolls back. Checking first and writing after would leave
 * exactly that window open.
 */
export async function consumeInvitation(
  tx: Tx,
  input: { invitationId: string; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(invitation)
    .set({ usedAt: input.now, usedByUserId: input.userId })
    .where(and(eq(invitation.id, input.invitationId), isNull(invitation.usedAt)))
    .returning({ id: invitation.id })
  return rows.length > 0
}

export async function revokeInvitation(input: {
  invitationId: string
}): Promise<{ ok: true } | { ok: false; code: InvitationError }> {
  const { db } = await import('./db')
  const [row] = await db
    .select({ usedAt: invitation.usedAt, revokedAt: invitation.revokedAt })
    .from(invitation)
    .where(eq(invitation.id, input.invitationId))
    .limit(1)

  if (!row) return { ok: false, code: 'NOT_FOUND' }
  if (row.usedAt) return { ok: false, code: 'ALREADY_USED' }
  if (row.revokedAt) return { ok: false, code: 'REVOKED' }

  await db
    .update(invitation)
    .set({ revokedAt: new Date() })
    .where(eq(invitation.id, input.invitationId))
  return { ok: true }
}

/** Invitations issued, newest first. The token is not among the columns. */
export async function listInvitations() {
  const { db } = await import('./db')
  return db
    .select({
      id: invitation.id,
      email: invitation.email,
      note: invitation.note,
      expiresAt: invitation.expiresAt,
      usedAt: invitation.usedAt,
      revokedAt: invitation.revokedAt,
      createdAt: invitation.createdAt,
      inviterName: user.name,
    })
    .from(invitation)
    .leftJoin(user, eq(user.id, invitation.invitedBy))
    .orderBy(desc(invitation.createdAt))
}

import { createServerFn } from '@tanstack/solid-start'
import type { InvitationError } from './invitation'
import type { ModerationError, RosterEntry } from './moderation'
import type { OpenNomination, PromotionError, Tally } from './promotion'

/**
 * Governance endpoints: the roster, blocking, nominations and invitations.
 *
 * Every one re-checks the caller's role on the server. A route guard is UX — a
 * `createServerFn` is a public HTTP endpoint anyone can call directly, and
 * these are the endpoints that hand out membership and take it away.
 */
async function requireSenior() {
  const { requireRole } = await import('./session.server')
  return requireRole(['senior_member', 'super_admin'])
}

export type GovernanceErrorCode =
  | ModerationError
  | PromotionError
  | InvitationError
  | 'FORBIDDEN'
  | 'UNEXPECTED'

export type GovernanceResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; code: GovernanceErrorCode }

export const fetchRoster = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<RosterEntry>> => {
    const actor = await requireSenior()
    const { listRoster } = await import('./moderation')
    return listRoster(actor.id)
  },
)

export const setBlockedStatus = createServerFn({ method: 'POST' })
  .inputValidator((data: { userId: string; blocked: boolean; rationale: string }) => {
    if (!data?.userId) throw new Error('userId is required')
    if (typeof data.blocked !== 'boolean') throw new Error('blocked is required')
    return {
      userId: data.userId,
      blocked: data.blocked,
      rationale: String(data.rationale ?? ''),
    }
  })
  .handler(async ({ data }): Promise<GovernanceResult<{ blocked: boolean }>> => {
    const actor = await requireSenior()
    const { setBlocked } = await import('./moderation')
    try {
      const result = await setBlocked({
        subjectUserId: data.userId,
        blocked: data.blocked,
        rationale: data.rationale,
        actor: { id: actor.id, role: actor.role },
      })
      if (!result.ok) return { ok: false, code: result.code }
      // Best effort, after the fact: the block has already taken effect, and a
      // mail provider outage must not leave the account half-blocked.
      void notifyBlockChange(data.userId, data.blocked, data.rationale)
      return { ok: true, blocked: result.blocked }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

async function notifyBlockChange(userId: string, blocked: boolean, rationale: string) {
  try {
    const [{ db }, { user }, { eq }, { getMailer }, templates, { resolveRequestLocale }] =
      await Promise.all([
        import('./db'),
        import('./db/schema'),
        import('drizzle-orm'),
        import('./email/mailer'),
        import('./email/templates'),
        import('./email/locale'),
      ])
    const [row] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    if (!row) return

    const locale = resolveRequestLocale()
    const message = blocked
      ? templates.renderBlockedEmail({ name: row.name, rationale, locale })
      : templates.renderUnblockedEmail({ name: row.name, locale })
    await getMailer().send({ to: row.email, ...message })
  } catch {
    // The audit row is the record that matters; a failed notice is not a reason
    // to leave a blocked account usable.
  }
}

export const openNomination = createServerFn({ method: 'POST' })
  .inputValidator((data: { userId: string; rationale: string }) => {
    if (!data?.userId) throw new Error('userId is required')
    return { userId: data.userId, rationale: String(data.rationale ?? '') }
  })
  .handler(async ({ data }): Promise<GovernanceResult<{ promotionId: string }>> => {
    const actor = await requireSenior()
    const { nominate } = await import('./promotion')
    try {
      const result = await nominate({
        subjectUserId: data.userId,
        rationale: data.rationale,
        actorId: actor.id,
      })
      if (!result.ok) return { ok: false, code: result.code }
      return { ok: true, promotionId: result.promotionId }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

export const fetchNominations = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<OpenNomination>> => {
    const actor = await requireSenior()
    const { listOpenNominations } = await import('./promotion')
    return listOpenNominations(actor.id)
  },
)

export const voteOnNomination = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { promotionId: string; vote: 'approve' | 'reject'; rationale: string }) => {
      if (!data?.promotionId) throw new Error('promotionId is required')
      if (!['approve', 'reject'].includes(data.vote)) throw new Error('Unknown vote')
      return {
        promotionId: data.promotionId,
        vote: data.vote,
        rationale: String(data.rationale ?? ''),
      }
    },
  )
  .handler(
    async ({
      data,
    }): Promise<
      GovernanceResult<{ outcome: 'open' | 'approved' | 'rejected'; tally: Tally }>
    > => {
      const actor = await requireSenior()
      const { castVote } = await import('./promotion')
      try {
        const result = await castVote({
          promotionId: data.promotionId,
          vote: data.vote,
          rationale: data.rationale,
          voterId: actor.id,
        })
        if (!result.ok) return { ok: false, code: result.code }
        return { ok: true, outcome: result.outcome, tally: result.tally }
      } catch {
        return { ok: false, code: 'UNEXPECTED' }
      }
    },
  )

export const withdrawNomination = createServerFn({ method: 'POST' })
  .inputValidator((data: { promotionId: string }) => {
    if (!data?.promotionId) throw new Error('promotionId is required')
    return { promotionId: data.promotionId }
  })
  .handler(async ({ data }): Promise<GovernanceResult> => {
    const actor = await requireSenior()
    const { withdraw } = await import('./promotion')
    try {
      const result = await withdraw({
        promotionId: data.promotionId,
        actorId: actor.id,
      })
      if (!result.ok) return { ok: false, code: result.code }
      return { ok: true }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

export const fetchInvitations = createServerFn({ method: 'GET' }).handler(async () => {
  await requireSenior()
  const { listInvitations } = await import('./invitation')
  return listInvitations()
})

/**
 * Issue an invitation and mail the link.
 *
 * The raw token is returned to the sponsor as well as emailed. Delivery to a
 * Haitian inbox is not something to take on faith, and an invitation the
 * sponsor cannot pass on by hand is an invitation that quietly never arrives.
 * It is shown once and stored nowhere.
 */
export const issueInvitationAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { email: string; note: string }) => {
    return { email: String(data?.email ?? ''), note: String(data?.note ?? '') }
  })
  .handler(
    async ({ data }): Promise<GovernanceResult<{ url: string; email: string }>> => {
      const actor = await requireSenior()
      const { issueInvitation } = await import('./invitation')
      try {
        const result = await issueInvitation({
          email: data.email,
          note: data.note,
          actorId: actor.id,
        })
        if (!result.ok) return { ok: false, code: result.code }

        const { env } = await import('../env')
        const url = `${env.BETTER_AUTH_URL}/auth/register/invited?token=${encodeURIComponent(result.token)}`

        const [{ getMailer }, { renderInvitationEmail }, { resolveRequestLocale }] =
          await Promise.all([
            import('./email/mailer'),
            import('./email/templates'),
            import('./email/locale'),
          ])
        await getMailer().send({
          to: result.email,
          ...renderInvitationEmail({
            sponsor: actor.name,
            url,
            expiresAt: result.expiresAt,
            locale: resolveRequestLocale(),
          }),
        })

        return { ok: true, url, email: result.email }
      } catch {
        return { ok: false, code: 'UNEXPECTED' }
      }
    },
  )

export const revokeInvitationAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { invitationId: string }) => {
    if (!data?.invitationId) throw new Error('invitationId is required')
    return { invitationId: data.invitationId }
  })
  .handler(async ({ data }): Promise<GovernanceResult> => {
    await requireSenior()
    const { revokeInvitation } = await import('./invitation')
    try {
      const result = await revokeInvitation({ invitationId: data.invitationId })
      if (!result.ok) return { ok: false, code: result.code }
      return { ok: true }
    } catch {
      return { ok: false, code: 'UNEXPECTED' }
    }
  })

/**
 * Check an invitation token from the public registration page.
 *
 * Unauthenticated by necessity — the holder has no account yet. It returns only
 * the address the invitation was issued to and the sponsor's name, never the
 * note or anything else about the movement's internals.
 */
export const inspectInvitation = createServerFn({ method: 'GET' })
  .inputValidator((data: { token: string }) => ({ token: String(data?.token ?? '') }))
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; email: string; sponsor: string | null }
      | { ok: false; code: InvitationError }
    > => {
      const [{ getRequest }, { consume, clientIp, RULES }] = await Promise.all([
        import('@tanstack/solid-start/server'),
        import('./rate-limit'),
      ])
      const ip = clientIp(getRequest().headers)
      const allowed = await consume(`inviteLookup:ip:${ip}`, RULES.inviteLookup)
      if (!allowed.allowed) return { ok: false, code: 'NOT_FOUND' }

      const { checkInvitation } = await import('./invitation')
      const checked = await checkInvitation(data.token)
      if (!checked.ok) return { ok: false, code: checked.code }

      const [{ db }, { user }, { eq }] = await Promise.all([
        import('./db'),
        import('./db/schema'),
        import('drizzle-orm'),
      ])
      let sponsor: string | null = null
      if (checked.invitation.invitedBy) {
        const [row] = await db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, checked.invitation.invitedBy))
          .limit(1)
        sponsor = row?.name ?? null
      }
      return { ok: true, email: checked.invitation.email, sponsor }
    },
  )

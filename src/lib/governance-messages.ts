import { m } from '../paraglide/messages'
import type { GovernanceErrorCode } from './governance-actions'

/**
 * One translation of every governance refusal.
 *
 * The union is the sum of the moderation, promotion and invitation error types,
 * so adding a refusal anywhere in that code will not compile until it has words
 * in both languages.
 */
export const GOVERNANCE_ERROR_MESSAGE: Record<GovernanceErrorCode, () => string> = {
  FORBIDDEN: m.review_errors_forbidden,
  NOT_FOUND: m.review_errors_notFound,
  UNEXPECTED: m.review_errors_unexpected,
  RATIONALE_REQUIRED: m.review_errors_rationaleRequired,

  // Moderation
  SELF_TARGET: m.roster_errors_selfTarget,
  RANK_TOO_HIGH: m.roster_errors_rankTooHigh,
  ALREADY_IN_STATE: m.roster_errors_alreadyInState,

  // Promotion
  NOT_ELIGIBLE: m.roster_errors_notEligible,
  ALREADY_OPEN: m.roster_errors_alreadyOpen,
  SELF_NOMINATION: m.roster_errors_selfNomination,
  SELF_VOTE: m.promotions_errors_selfVote,
  ALREADY_VOTED: m.promotions_errors_alreadyVoted,
  ALREADY_CLOSED: m.promotions_errors_alreadyClosed,

  // Invitations
  INVALID_EMAIL: m.invitations_errors_invalidEmail,
  NOTE_REQUIRED: m.invitations_errors_noteRequired,
  EMAIL_TAKEN: m.invitations_errors_emailTaken,
  ALREADY_USED: m.invitations_errors_alreadyUsed,
  REVOKED: m.invitations_errors_revoked,
  EXPIRED: m.invitations_errors_expired,
}

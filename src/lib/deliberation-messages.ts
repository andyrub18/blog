import { m } from '../paraglide/messages'
import type { ReviewErrorCode } from './article-review-actions'
import type { DecisionMethod, DecisionOutcome } from './db/schema'

/**
 * One translation of every deliberation refusal, keyed by the error union.
 *
 * A `Record` rather than a lookup by string, so adding a code without
 * translating it is a type error instead of a blank message somebody notices in
 * production. Mapped to the message *function*, never to a key string — a
 * dynamic key lookup defeats Paraglide's tree-shaking.
 */
export const DELIBERATION_ERROR_MESSAGE: Record<ReviewErrorCode, () => string> = {
  FORBIDDEN: m.deliberation_errors_forbidden,
  NOT_FOUND: m.deliberation_errors_notFound,
  NOT_AUTHOR: m.deliberation_errors_notAuthor,
  NO_LANGUAGES: m.deliberation_errors_noLanguages,
  LANGUAGE_EMPTY: m.deliberation_errors_languageEmpty,
  DOCUMENTATION_REQUIRED: m.deliberation_errors_documentationRequired,
  RATIONALE_REQUIRED: m.deliberation_errors_rationaleRequired,
  ALREADY_SUBMITTED: m.deliberation_errors_alreadySubmitted,
  WRONG_STATE: m.deliberation_errors_wrongState,
  NO_QUORUM: m.deliberation_errors_noQuorum,
  SELF_REVIEW: m.deliberation_errors_selfReview,
  NOT_ASSIGNED: m.deliberation_errors_notAssigned,
  ALREADY_VOTED: m.deliberation_errors_alreadyVoted,
  LANGUAGE_NOT_IN_SUBMISSION: m.deliberation_errors_languageNotInSubmission,
  REVIEWERS_STILL_SILENT: m.deliberation_errors_reviewersStillSilent,
  UNEXPECTED: m.deliberation_errors_unexpected,
}

/** Why a language did or did not clear the threshold, in the reader's language. */
export const LANGUAGE_REASON_MESSAGE: Record<string, () => string> = {
  accepted: m.deliberation_reason_accepted,
  no_contradictor: m.deliberation_reason_no_contradictor,
  too_few_supports: m.deliberation_reason_too_few_supports,
  below_threshold: m.deliberation_reason_below_threshold,
}

export const SUBMISSION_STATUS_MESSAGE: Record<string, () => string> = {
  open: m.deliberation_status_open,
  in_review: m.deliberation_status_in_review,
  decided: m.deliberation_status_decided,
  withdrawn: m.deliberation_status_withdrawn,
}

export const OUTCOME_MESSAGE: Record<DecisionOutcome, () => string> = {
  accepted: m.deliberation_outcome_accepted,
  revision_requested: m.deliberation_outcome_revision_requested,
  rejected: m.deliberation_outcome_rejected,
}

export const METHOD_MESSAGE: Record<DecisionMethod, () => string> = {
  consensus: m.deliberation_method_consensus,
  qualified_majority: m.deliberation_method_qualified_majority,
}

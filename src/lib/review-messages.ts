import { m } from '../paraglide/messages'
import type { ReviewErrorCode } from './review-actions'

/**
 * One translation of each review refusal, shared by every review screen.
 *
 * The application queue and the probation queue return codes from the same
 * union, so keeping two maps meant a new code silently had no message on one of
 * the pages. Here the compiler catches it.
 */
export const REVIEW_ERROR_MESSAGE: Record<ReviewErrorCode, () => string> = {
  FORBIDDEN: m.review_errors_forbidden,
  NOT_FOUND: m.review_errors_notFound,
  ALREADY_DECIDED: m.review_errors_alreadyDecided,
  SELF_REVIEW: m.review_errors_selfReview,
  RATIONALE_REQUIRED: m.review_errors_rationaleRequired,
  NOT_IN_PROBATION: m.probation_errors_notInProbation,
  TOO_EARLY: m.probation_errors_tooEarly,
  UNEXPECTED: m.review_errors_unexpected,
}

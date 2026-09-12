import { m } from '../paraglide/messages'
import type { ForumErrorCode } from './forum-actions'
import {
  MAX_FORUM_POST_CHARS,
  MIN_FORUM_POST_CHARS,
  MIN_MODERATION_RATIONALE_CHARS,
} from './validation'

/**
 * One translation of each forum refusal.
 *
 * A `Record` keyed by the error union rather than a lookup by string: adding a
 * code without translating it becomes a type error instead of a blank message
 * somebody notices in production. Each entry names the message *function*, so
 * Paraglide can still tree-shake — a dynamic key lookup would pull every
 * message in the project into the bundle.
 */
export const FORUM_ERROR_MESSAGE: Record<ForumErrorCode, () => string> = {
  FORBIDDEN: m.forum_errors_forbidden,
  NOT_FOUND: m.forum_errors_notFound,
  INVALID_BODY: () =>
    m.forum_errors_invalidBody({
      min: MIN_FORUM_POST_CHARS,
      max: MAX_FORUM_POST_CHARS,
    }),
  RATIONALE_REQUIRED: () =>
    m.forum_errors_rationaleRequired({ min: MIN_MODERATION_RATIONALE_CHARS }),
  ALREADY_IN_STATE: m.forum_errors_alreadyInState,
  RATE_LIMITED: m.forum_errors_rateLimited,
  UNEXPECTED: m.forum_errors_unexpected,
}

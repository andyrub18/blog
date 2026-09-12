import { m } from '../paraglide/messages'
import type { ArticleErrorCode } from './article-actions'

/**
 * One translation of each article refusal, shared by every article screen.
 *
 * A `Record` keyed by the error union rather than a lookup by string: adding a
 * code to `ArticleError` without translating it becomes a type error instead of
 * a blank message somebody notices in production. Mapped to the message
 * *function*, never to a key — a dynamic key lookup would defeat Paraglide's
 * tree-shaking and pull every message into the bundle.
 */
export const ARTICLE_ERROR_MESSAGE: Record<ArticleErrorCode, () => string> = {
  FORBIDDEN: m.write_errors_forbidden,
  NOT_FOUND: m.write_errors_notFound,
  INVALID_TITLE: m.write_errors_invalidTitle,
  INVALID_SUMMARY: m.write_errors_invalidSummary,
  INVALID_CONTENT: m.write_errors_invalidContent,
  EMPTY_CONTENT: m.write_errors_emptyContent,
  NO_SLUG: m.write_errors_noSlug,
  ALREADY_PUBLISHED: m.write_errors_alreadyPublished,
  NOT_PUBLISHED: m.write_errors_notPublished,
  UNEXPECTED: m.write_errors_unexpected,
}

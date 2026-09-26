import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { article, articleRevision } from './article'
import { articleSubmission } from './article-review'
import { user } from './auth'

/**
 * The author's own typeset PDF of one language of an article (D24, D26).
 *
 * A companion, never a substitute: the article is still the text the circle
 * reviewed and the page readers land on. The PDF is for the reader who wants
 * the whole proposal on paper or offline, typeset the way the author made it.
 *
 * **It is tied to the revision it was made from, and stops being offered the
 * moment the text moves on.** A PDF is a published statement in the movement's
 * name; one that no longer matches the reviewed text is a position nobody
 * decided on. Readers are better served by no PDF than by the wrong one — the
 * first is recoverable by the author in a minute, the second is not
 * recoverable at all once it has been forwarded.
 *
 * **And it is offered only once the circle has approved it (D29).** The PDF is
 * reviewed with the text: reviewers download it from the submission page, and
 * when `decide()` accepts a language it stamps the companion that was attached
 * before that round was submitted and still matches the text. One attached
 * later — a replacement after publication included — waits for the next round.
 * Nobody publishes a PDF alone, for the same reason nobody publishes text alone.
 *
 * Append-only, like revisions. Replacing or removing a companion closes its row
 * rather than overwriting it, so the record of which file was offered, from
 * when to when and by whom, survives even though the superseded bytes do not.
 * `sha256` is what makes that record worth keeping: anyone holding a copy of a
 * disputed PDF can check whether it is the one KLEA served.
 */
export const articleCompanion = pgTable(
  'article_companion',
  {
    id: text('id').primaryKey(),
    articleId: text('article_id')
      .notNull()
      .references(() => article.id, { onDelete: 'cascade' }),
    lang: text('lang').notNull(),
    /** The text this PDF was made from. When it is not the latest, the PDF is stale. */
    revisionId: text('revision_id')
      .notNull()
      .references(() => articleRevision.id, { onDelete: 'cascade' }),
    /** Under `uploads/`. Null once superseded, when the bytes are deleted. */
    storagePath: text('storage_path'),
    byteSize: integer('byte_size').notNull(),
    pageCount: integer('page_count').notNull(),
    sha256: text('sha256').notNull(),
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * The round whose decision approved this file for readers, and when. Null
     * until then — an unapproved companion is visible to its author and to the
     * circle, never to readers.
     */
    approvedInSubmissionId: text('approved_in_submission_id').references(
      () => articleSubmission.id,
      { onDelete: 'set null' },
    ),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** When it was replaced or removed, and by whom. Null while it is the current one. */
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    supersededBy: text('superseded_by').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('article_companion_article_idx').on(
      table.articleId,
      table.lang,
      table.uploadedAt,
    ),
    // At most one current companion per language. Two would make "the PDF of
    // this article" a question with two answers.
    uniqueIndex('one_current_companion_per_lang')
      .on(table.articleId, table.lang)
      .where(sql`${table.supersededAt} is null`),
  ],
)

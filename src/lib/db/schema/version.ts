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
import { articleCompanion } from './companion'

/**
 * What became of a version in its round.
 *
 * `withdrawn` is kept rather than deleted: the number was given out, and a
 * history with a gap nobody can explain is worse than one that says the author
 * took version 4 back before the circle decided on it.
 */
export const VERSION_OUTCOMES = ['pending', 'approved', 'refused', 'withdrawn'] as const
export type VersionOutcome = (typeof VERSION_OUTCOMES)[number]

/**
 * One language of an article as it was put to the circle (D31).
 *
 * A version is made when a language is submitted — not on every save, which is
 * what `article_revision` records. It freezes the two things the circle reviews
 * together: the text (`revision_id`) and the companion PDF, if the author had
 * attached one made from that text (`companion_id`). The round's decision
 * approves or refuses the version as a whole, and what readers are shown is the
 * highest approved version of their language.
 *
 * Numbered per language, from 1, in submission order. Every submitted version
 * takes a number whatever its outcome, so "version 3" means the same thing to an
 * author, a reviewer and a reader; readers are shown only the approved ones, and
 * are told why the numbers can skip.
 */
export const articleVersion = pgTable(
  'article_version',
  {
    id: text('id').primaryKey(),
    articleId: text('article_id')
      .notNull()
      .references(() => article.id, { onDelete: 'cascade' }),
    lang: text('lang').notNull(),
    number: integer('number').notNull(),
    /**
     * The round it was submitted in. Null only for versions that predate
     * versions — migrated from text published before they existed.
     */
    submissionId: text('submission_id').references(() => articleSubmission.id, {
      onDelete: 'cascade',
    }),
    revisionId: text('revision_id')
      .notNull()
      .references(() => articleRevision.id, { onDelete: 'cascade' }),
    /**
     * The PDF submitted with this text. Its bytes are kept for as long as a
     * version refers to it: the published version must go on serving its PDF
     * while the author prepares the next one, and a reviewer comparing two
     * versions needs both files.
     */
    companionId: text('companion_id').references(() => articleCompanion.id, {
      onDelete: 'set null',
    }),
    outcome: text('outcome').$type<VersionOutcome>().notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    // One number per version of a language. Two submissions of the same
    // language cannot both be version 4.
    uniqueIndex('one_version_number_per_lang').on(
      table.articleId,
      table.lang,
      table.number,
    ),
    // A round submits a language once.
    uniqueIndex('one_version_per_round_lang').on(table.submissionId, table.lang),
    index('article_version_article_idx').on(table.articleId, table.lang),
  ],
)

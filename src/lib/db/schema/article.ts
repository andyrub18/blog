import { index, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'

/**
 * Articles, and their per-language variants.
 *
 * An article is one piece of work; a translation is that work in one language.
 * The pair `(article_id, lang)` is what an author writes, what a reviewer
 * validates and what a reader lands on — the manifesto's movement works in
 * Creole and French at once, and treating a translation as a second article
 * would lose the connection between them.
 */

/**
 * Who may read a published article (DECISIONS.md, D1).
 *
 * `public` is the default and the norm: a movement whose purpose is national
 * influence should not hide its output behind a signup wall, and these are the
 * articles search engines index. `members` is the deliberate exception, for
 * internal work that is not yet the movement's public position.
 */
export const ARTICLE_VISIBILITIES = ['public', 'members'] as const
export type ArticleVisibility = (typeof ARTICLE_VISIBILITIES)[number]

/**
 * Where the article as a whole stands.
 *
 * The middle four states belong to the adversarial review process in
 * `docs/phases/02-ARTICLES-REVIEW.md`, which ships in phase 3. `published`
 * means at least one language has gone live; `archived` withdraws every
 * language at once.
 */
export const ARTICLE_STATUSES = [
  'draft',
  'submitted',
  'in_review',
  'revision_requested',
  'published',
  'archived',
] as const
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number]

export const article = pgTable(
  'article',
  {
    id: text('id').primaryKey(),
    /** Stable across languages: one URL, whichever language the reader wants. */
    slug: text('slug').notNull().unique(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    visibility: text('visibility').$type<ArticleVisibility>().notNull().default('public'),
    status: text('status').$type<ArticleStatus>().notNull().default('draft'),
    /** When the first language went live. The per-language dates are on the translation. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('article_author_idx').on(table.authorId),
    index('article_status_idx').on(table.status),
  ],
)

/**
 * Publication is per language, so a translation carries its own state.
 *
 * `article.status` is the life of the work; this is the life of one language of
 * it. Publishing `fr` while `ht` is still being written is the normal case, not
 * an edge case, and a single article-level flag would put an unfinished Creole
 * draft in front of readers the moment the French was ready.
 */
export const TRANSLATION_STATUSES = ['draft', 'published'] as const
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number]

export const articleTranslation = pgTable(
  'article_translation',
  {
    articleId: text('article_id')
      .notNull()
      .references(() => article.id, { onDelete: 'cascade' }),
    /**
     * Not constrained to the UI locales. A translation may exist in a language
     * the interface does not yet speak, and phase 6 adds `en` and `es` by
     * adding message files — it should not need a migration to allow an
     * article in them.
     */
    lang: text('lang').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    /**
     * ProseMirror JSON, never HTML (DECISIONS.md, D10).
     *
     * It diffs cleanly between review rounds, which is what the adversarial
     * stage needs, and it cannot carry script: anything outside the schema in
     * `lib/prosemirror.ts` is dropped when the document is parsed, on the
     * server, before it is ever stored.
     */
    contentJson: jsonb('content_json').notNull(),
    status: text('status').$type<TranslationStatus>().notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.articleId, table.lang] }),
    index('article_translation_lang_idx').on(table.lang, table.status),
  ],
)

/**
 * Every saved version of every language, append-only.
 *
 * A contradictor assigned to argue against a proposal has to be able to see
 * precisely what changed between round two and round three; an editor that only
 * keeps the current text makes that impossible to check. Revisions are also the
 * only defence against an author quietly rewriting a published position.
 */
export const articleRevision = pgTable(
  'article_revision',
  {
    id: text('id').primaryKey(),
    articleId: text('article_id')
      .notNull()
      .references(() => article.id, { onDelete: 'cascade' }),
    lang: text('lang').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    contentJson: jsonb('content_json').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('article_revision_article_idx').on(
      table.articleId,
      table.lang,
      table.createdAt,
    ),
  ],
)

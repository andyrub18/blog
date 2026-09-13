import { type AnyPgColumn, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { article } from './article'
import { user } from './auth'

/**
 * The forum: one discussion per article.
 *
 * Not one per language. An article is one piece of work — D12 splits
 * *publication* by language, not the work itself — and splitting the
 * conversation would put Creole readers in one room and French readers in
 * another, which in practice means the smaller room goes quiet. `lang` records
 * which language the poster was reading, so a post can be labelled or filtered
 * without a migration.
 */

/**
 * A post is visible, taken down by its author, or hidden by a moderator.
 *
 * Nothing is deleted. A thread that silently loses a post tells the people who
 * answered it a lie about what they were answering, and the two ways a post can
 * go are not the same fact: `withdrawn` is the author's own second thought,
 * `hidden` is a decision somebody else made and has to account for.
 */
export const FORUM_POST_STATUSES = ['visible', 'withdrawn', 'hidden'] as const
export type ForumPostStatus = (typeof FORUM_POST_STATUSES)[number]

export const forumPost = pgTable(
  'forum_post',
  {
    id: text('id').primaryKey(),
    articleId: text('article_id')
      .notNull()
      .references(() => article.id, { onDelete: 'cascade' }),
    /** The language the poster was reading when they wrote this. */
    lang: text('lang').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * Null for a top-level post. One level only: a reply to a reply is stored
     * against the same parent, because arbitrary nesting is a rendering,
     * moderation and mobile-layout problem in exchange for a distinction people
     * mostly do not use.
     */
    parentId: text('parent_id').references((): AnyPgColumn => forumPost.id, {
      onDelete: 'cascade',
    }),
    /** Plain text, never HTML and never a document. See `lib/forum.ts`. */
    body: text('body').notNull(),
    status: text('status').$type<ForumPostStatus>().notNull().default('visible'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the author corrects a post, so the thread can say so. */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    /**
     * Any change at all: written, edited, withdrawn, hidden, restored.
     *
     * This is what the poller asks for — "anything since?" — and it is a
     * separate column from `created_at` because the changes that matter most
     * are the ones that do not create a row. Polling on `created_at` would let
     * a post a moderator has just hidden stay on screen in every tab that
     * already had it, which is precisely the case moderation is for.
     */
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The query this table exists to answer: one article's thread, in order.
    index('forum_post_article_idx').on(table.articleId, table.createdAt),
    // And the one the poller asks every few seconds: what changed since?
    index('forum_post_changed_idx').on(table.articleId, table.changedAt),
    index('forum_post_parent_idx').on(table.parentId),
    // "What has this account been posting" — the question moderation asks.
    index('forum_post_author_idx').on(table.authorId, table.createdAt),
  ],
)

export const FORUM_MODERATION_ACTIONS = ['hidden', 'restored'] as const
export type ForumModerationAction = (typeof FORUM_MODERATION_ACTIONS)[number]

/**
 * Why a post was hidden, append-only.
 *
 * A `hidden_reason` column on the post would be overwritten by the second
 * decision and lose the first, which is exactly what an account of a moderation
 * is for. Same shape as `role_change` and `access_event`: the manifesto's
 * *reddition de comptes* is these tables.
 */
export const forumModeration = pgTable(
  'forum_moderation',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => forumPost.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').$type<ForumModerationAction>().notNull(),
    /** Required. A moderation without a stated reason is not accountable. */
    rationale: text('rationale').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('forum_moderation_post_idx').on(table.postId)],
)

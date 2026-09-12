import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, like, ne } from 'drizzle-orm'
import { DEFAULT_LOCALE, type Locale } from '../i18n'
import {
  type ArticleVisibility,
  article,
  articleRevision,
  articleTranslation,
  hasAtLeastRole,
  type Role,
  user,
} from './db/schema'
import {
  type DocNode,
  docToPlainText,
  parseDocument,
  readingTimeMinutes,
  renderDocumentToHtml,
} from './prosemirror'
import {
  isValidArticleSummary,
  isValidArticleTitle,
  isValidSlug,
  MAX_SLUG_CHARS,
  slugify,
} from './validation'

/**
 * Articles: who may write one, what a translation is, and what a reader gets.
 *
 * The review workflow is not here. Phase 3 puts a documented submission and
 * assigned contradictors between a finished draft and a published article; the
 * tables for it already exist in `db/schema/article-review.ts`. Until then
 * `publishTranslation` is the provisional path, and it is deliberately *not*
 * something an author can do to their own work — see the comment on it.
 */

export type Viewer = {
  id: string
  role: Role
  memberStatus: string
}

export type ArticleError =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_TITLE'
  | 'INVALID_SUMMARY'
  | 'INVALID_CONTENT'
  | 'EMPTY_CONTENT'
  | 'NO_SLUG'
  | 'ALREADY_PUBLISHED'
  | 'NOT_PUBLISHED'

export type ArticleResult<T> = { ok: true; value: T } | { ok: false; code: ArticleError }

/**
 * Writing is the member tier's privilege (DECISIONS.md, D2).
 *
 * A reader reads and takes part in the forum; proposing an article to the
 * movement is what admission by dossier buys. Probation does not change this —
 * a member inside their six months writes like any other member, because the
 * probation asks whether they kept their commitments, and contributing is the
 * commitment.
 */
export function canWrite(viewer: Viewer): boolean {
  return viewer.memberStatus !== 'blocked' && hasAtLeastRole(viewer.role, 'member')
}

/** Senior members decide what the movement publishes under its own name. */
export function canPublish(viewer: Viewer): boolean {
  return viewer.memberStatus !== 'blocked' && hasAtLeastRole(viewer.role, 'senior_member')
}

/**
 * Who may open a draft.
 *
 * The author, and senior members — the people who will have to review it. An
 * unpublished draft is the author's thinking before they are ready to defend
 * it, and the manifesto's process starts when they submit it, not when somebody
 * goes looking.
 */
export function canEdit(viewer: Viewer, authorId: string): boolean {
  if (viewer.memberStatus === 'blocked') return false
  return viewer.id === authorId || hasAtLeastRole(viewer.role, 'senior_member')
}

/**
 * Whether this reader may see a published article.
 *
 * `public` is genuinely public — no account, no cookie, nothing (D1). Reach is
 * the point, and these are the articles search engines index. `members` asks
 * only for an account, because `reader` is the tier that may read everything;
 * it marks internal work, not secret work.
 */
export function canRead(visibility: ArticleVisibility, viewer: Viewer | null): boolean {
  if (visibility === 'public') return true
  return viewer !== null && viewer.memberStatus !== 'blocked'
}

/**
 * A slug nobody else is using.
 *
 * Two safeguards, because one is not enough. This picks a free suffix from what
 * is already in the table, and the unique constraint on `article.slug` catches
 * the case where two authors publish the same title in the same second — the
 * gap between reading and inserting is small but it is real, so the caller
 * retries rather than trusting this to be atomic.
 */
export async function nextFreeSlug(title: string): Promise<string | null> {
  const base = slugify(title)
  // A title with no Latin letters at all — the caller has to ask for one that
  // can be a URL rather than invent something the author did not write.
  if (!isValidSlug(base)) return null

  const { db } = await import('./db')
  const taken = await db
    .select({ slug: article.slug })
    .from(article)
    .where(like(article.slug, `${base}%`))

  const used = new Set(taken.map((row) => row.slug))
  if (!used.has(base)) return base

  for (let n = 2; n < 100; n += 1) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, MAX_SLUG_CHARS - suffix.length)}${suffix}`
    if (!used.has(candidate)) return candidate
  }

  const suffix = `-${randomUUID().slice(0, 8)}`
  return `${base.slice(0, MAX_SLUG_CHARS - suffix.length)}${suffix}`
}

export type CreateInput = {
  author: Viewer
  lang: string
  title: string
  summary: string
  visibility?: ArticleVisibility
}

/**
 * Start an article, in one language.
 *
 * The first language is just the one the author happens to be writing in; there
 * is no "original" and no "translation of" relationship, because a movement
 * that works in Creole and French does not have a source language. Other
 * languages are added later against the same article id.
 */
export async function createArticle(
  input: CreateInput,
): Promise<ArticleResult<{ articleId: string; slug: string }>> {
  if (!canWrite(input.author)) return { ok: false, code: 'FORBIDDEN' }
  if (!isValidArticleTitle(input.title)) return { ok: false, code: 'INVALID_TITLE' }
  if (!isValidArticleSummary(input.summary)) return { ok: false, code: 'INVALID_SUMMARY' }

  const { db } = await import('./db')

  // Two attempts, because `nextFreeSlug` reads the table and the unique
  // constraint is what actually decides. The window between the two is small
  // and real — two authors publishing the same title in the same second — and a
  // second pass picks the suffix the first attempt could not have seen.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const slug = await nextFreeSlug(input.title)
    if (!slug) return { ok: false, code: 'NO_SLUG' }

    const id = randomUUID()
    try {
      await db.transaction(async (tx) => {
        await tx.insert(article).values({
          id,
          slug,
          authorId: input.author.id,
          visibility: input.visibility ?? 'public',
          status: 'draft',
        })
        await tx.insert(articleTranslation).values({
          articleId: id,
          lang: input.lang,
          title: input.title.trim(),
          summary: input.summary.trim(),
          contentJson: { type: 'doc', content: [] },
          status: 'draft',
        })
      })
      return { ok: true, value: { articleId: id, slug } }
    } catch (error) {
      if (attempt === 1) throw error
    }
  }

  return { ok: false, code: 'NO_SLUG' }
}

export type SaveInput = {
  actor: Viewer
  articleId: string
  lang: string
  title: string
  summary: string
  /** Untrusted: whatever the editor in the browser sent. */
  content: unknown
}

/**
 * Save one language of an article, and keep the version that came before.
 *
 * Two things happen together or not at all: the translation is updated and a
 * revision is appended. A save that wrote the new text but lost the revision
 * would quietly destroy the record a contradictor needs to see what changed
 * between rounds, and nobody would notice until the argument mattered.
 *
 * The document is parsed here, on the server, before it is stored. The editor
 * runs on the author's machine and its output is a request, not a fact.
 */
export async function saveTranslation(
  input: SaveInput,
): Promise<ArticleResult<{ savedAt: Date }>> {
  if (!isValidArticleTitle(input.title)) return { ok: false, code: 'INVALID_TITLE' }
  if (!isValidArticleSummary(input.summary)) return { ok: false, code: 'INVALID_SUMMARY' }

  const parsed = parseDocument(input.content)
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code === 'EMPTY' ? 'EMPTY_CONTENT' : 'INVALID_CONTENT',
    }
  }

  const { db } = await import('./db')
  const [row] = await db
    .select({ id: article.id, authorId: article.authorId })
    .from(article)
    .where(eq(article.id, input.articleId))
    .limit(1)

  if (!row) return { ok: false, code: 'NOT_FOUND' }
  if (!canEdit(input.actor, row.authorId)) return { ok: false, code: 'FORBIDDEN' }

  const now = new Date()
  const title = input.title.trim()
  const summary = input.summary.trim()

  await db.transaction(async (tx) => {
    await tx
      .insert(articleTranslation)
      .values({
        articleId: row.id,
        lang: input.lang,
        title,
        summary,
        contentJson: parsed.doc,
        status: 'draft',
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [articleTranslation.articleId, articleTranslation.lang],
        // `status` is absent on purpose: saving an edit to a published article
        // must not silently unpublish it, and must not silently publish a draft.
        set: { title, summary, contentJson: parsed.doc, updatedAt: now },
      })

    await tx.insert(articleRevision).values({
      id: randomUUID(),
      articleId: row.id,
      lang: input.lang,
      title,
      summary,
      contentJson: parsed.doc,
      createdBy: input.actor.id,
    })

    await tx.update(article).set({ updatedAt: now }).where(eq(article.id, row.id))
  })

  return { ok: true, value: { savedAt: now } }
}

/**
 * Publish one language of an article.
 *
 * **Provisional, and restricted to senior members on purpose.** The manifesto
 * does not let an author decide that their own proposal has been accepted, and
 * building a self-publish button now would be the hardest thing to take away
 * later — people would have been publishing that way for months by the time
 * phase 3 arrives. So the shape of the rule is right even though the process
 * behind it is not built yet: somebody other than the author decides, and when
 * the submission workflow lands it replaces the judgement, not the constraint.
 *
 * Per language, because that is how the movement actually works: the French is
 * ready and the Creole is still being written, and holding the French back
 * helps nobody.
 */
export async function publishTranslation(input: {
  actor: Viewer
  articleId: string
  lang: string
}): Promise<ArticleResult<{ publishedAt: Date }>> {
  if (!canPublish(input.actor)) return { ok: false, code: 'FORBIDDEN' }

  const { db } = await import('./db')
  const [row] = await db
    .select({
      articleId: article.id,
      articleStatus: article.status,
      articlePublishedAt: article.publishedAt,
      status: articleTranslation.status,
      contentJson: articleTranslation.contentJson,
    })
    .from(articleTranslation)
    .innerJoin(article, eq(article.id, articleTranslation.articleId))
    .where(
      and(
        eq(articleTranslation.articleId, input.articleId),
        eq(articleTranslation.lang, input.lang),
      ),
    )
    .limit(1)

  if (!row) return { ok: false, code: 'NOT_FOUND' }
  if (row.status === 'published') return { ok: false, code: 'ALREADY_PUBLISHED' }

  // An empty language would publish a title over a blank page.
  const parsed = parseDocument(row.contentJson)
  if (!parsed.ok) return { ok: false, code: 'EMPTY_CONTENT' }

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(articleTranslation)
      .set({ status: 'published', publishedAt: now, updatedAt: now })
      .where(
        and(
          eq(articleTranslation.articleId, input.articleId),
          eq(articleTranslation.lang, input.lang),
        ),
      )

    await tx
      .update(article)
      .set({
        status: 'published',
        // The article's own date is when it first reached anyone, so a second
        // language does not restate it.
        publishedAt: row.articlePublishedAt ?? now,
        updatedAt: now,
      })
      .where(eq(article.id, input.articleId))
  })

  return { ok: true, value: { publishedAt: now } }
}

/**
 * Take one language back off the site.
 *
 * The article row is left alone. Withdrawing the Creole while the French stands
 * is an editorial correction, not a retraction of the article, and conflating
 * the two would make the audit trail lie about what happened.
 */
export async function unpublishTranslation(input: {
  actor: Viewer
  articleId: string
  lang: string
}): Promise<ArticleResult<{ lang: string }>> {
  if (!canPublish(input.actor)) return { ok: false, code: 'FORBIDDEN' }

  const { db } = await import('./db')
  const now = new Date()
  let withdrawn = false

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(articleTranslation)
      .set({ status: 'draft', publishedAt: null, updatedAt: now })
      .where(
        and(
          eq(articleTranslation.articleId, input.articleId),
          eq(articleTranslation.lang, input.lang),
          eq(articleTranslation.status, 'published'),
        ),
      )
      .returning({ lang: articleTranslation.lang })

    if (updated.length === 0) return
    withdrawn = true

    // `article.status` means "at least one language is live". Withdrawing the
    // last one has to take it back down, or the row says the article is
    // published while nothing of it is readable.
    const stillLive = await tx
      .select({ lang: articleTranslation.lang })
      .from(articleTranslation)
      .where(
        and(
          eq(articleTranslation.articleId, input.articleId),
          eq(articleTranslation.status, 'published'),
        ),
      )
      .limit(1)

    await tx
      .update(article)
      .set({
        status: stillLive.length > 0 ? 'published' : 'draft',
        // `published_at` is kept: it records when this article first reached
        // anyone, and clearing it would erase that it ever did.
        updatedAt: now,
      })
      .where(eq(article.id, input.articleId))
  })

  if (!withdrawn) return { ok: false, code: 'NOT_PUBLISHED' }
  return { ok: true, value: { lang: input.lang } }
}

export type ArticleCard = {
  slug: string
  lang: string
  title: string
  summary: string
  publishedAt: Date | null
  authorName: string
  visibility: ArticleVisibility
  /** True when the reader is being shown a language they did not ask for. */
  isFallback: boolean
}

/**
 * Published articles, one card per article, in the best language available.
 *
 * The reader's language first, then the site default, then whatever exists.
 * Listing every translation separately would show the same article three times
 * to somebody who reads all three languages, which is noise, not choice.
 */
export async function listPublished(input: {
  lang: Locale
  viewer: Viewer | null
  limit?: number
}): Promise<Array<ArticleCard>> {
  const { db } = await import('./db')
  const visibilities: Array<ArticleVisibility> = input.viewer
    ? ['public', 'members']
    : ['public']

  const rows = await db
    .select({
      slug: article.slug,
      visibility: article.visibility,
      lang: articleTranslation.lang,
      title: articleTranslation.title,
      summary: articleTranslation.summary,
      publishedAt: articleTranslation.publishedAt,
      articlePublishedAt: article.publishedAt,
      authorName: user.name,
    })
    .from(articleTranslation)
    .innerJoin(article, eq(article.id, articleTranslation.articleId))
    .innerJoin(user, eq(user.id, article.authorId))
    .where(
      and(
        eq(articleTranslation.status, 'published'),
        eq(article.status, 'published'),
        inArray(article.visibility, visibilities),
      ),
    )
    .orderBy(desc(article.publishedAt))

  const bySlug = new Map<string, Array<(typeof rows)[number]>>()
  for (const row of rows) {
    const list = bySlug.get(row.slug)
    if (list) list.push(row)
    else bySlug.set(row.slug, [row])
  }

  const cards: Array<ArticleCard> = []
  for (const [slug, translations] of bySlug) {
    const chosen = pickTranslation(translations, input.lang)
    if (!chosen) continue
    cards.push({
      slug,
      lang: chosen.lang,
      title: chosen.title,
      summary: chosen.summary,
      publishedAt: chosen.publishedAt,
      authorName: chosen.authorName,
      visibility: chosen.visibility,
      isFallback: chosen.lang !== input.lang,
    })
  }

  cards.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
  return input.limit ? cards.slice(0, input.limit) : cards
}

/**
 * The fallback order: what the reader asked for, the site default, then anything.
 *
 * Never require all four languages. An author writes what they can, and a
 * reader who lands on a language nobody has written yet should get the article
 * with an honest note, not a 404 — the article exists, it is simply not in
 * their language yet.
 */
function pickTranslation<T extends { lang: string }>(
  translations: Array<T>,
  wanted: string,
): T | null {
  return (
    translations.find((t) => t.lang === wanted) ??
    translations.find((t) => t.lang === DEFAULT_LOCALE) ??
    translations[0] ??
    null
  )
}

export type ReadableArticle = {
  slug: string
  visibility: ArticleVisibility
  authorName: string
  lang: string
  requestedLang: string
  title: string
  summary: string
  doc: DocNode
  html: string
  readingMinutes: number
  publishedAt: Date | null
  /** Every language this article is published in, for the "read it in" links. */
  availableLangs: Array<string>
}

/**
 * One article for a reader, rendered.
 *
 * The HTML is produced here, on the server, from the stored document — which is
 * what keeps an article page close to zero client JavaScript. Readers arrive on
 * metered mobile data; shipping a renderer so the browser can rebuild markup we
 * already have would be paying twice.
 */
export async function getReadableArticle(input: {
  slug: string
  lang: Locale
  viewer: Viewer | null
}): Promise<ArticleResult<ReadableArticle>> {
  const { db } = await import('./db')
  const rows = await db
    .select({
      visibility: article.visibility,
      articleStatus: article.status,
      authorName: user.name,
      lang: articleTranslation.lang,
      title: articleTranslation.title,
      summary: articleTranslation.summary,
      contentJson: articleTranslation.contentJson,
      publishedAt: articleTranslation.publishedAt,
    })
    .from(article)
    .innerJoin(articleTranslation, eq(articleTranslation.articleId, article.id))
    .innerJoin(user, eq(user.id, article.authorId))
    .where(
      and(
        eq(article.slug, input.slug),
        eq(article.status, 'published'),
        eq(articleTranslation.status, 'published'),
      ),
    )

  if (rows.length === 0) return { ok: false, code: 'NOT_FOUND' }

  const visibility = rows[0].visibility
  // Refused rather than hidden: this reader may sign in and come back, and a
  // 404 for an article somebody linked them to is a worse answer than "log in".
  if (!canRead(visibility, input.viewer)) return { ok: false, code: 'FORBIDDEN' }

  const chosen = pickTranslation(rows, input.lang)
  if (!chosen) return { ok: false, code: 'NOT_FOUND' }

  const parsed = parseDocument(chosen.contentJson)
  // Parsed again on the way out, not only on the way in. The stored document
  // was sanitised when it was written, but the rules can tighten, and the row
  // could have been changed by something other than `saveTranslation`.
  const doc = parsed.ok ? parsed.doc : { type: 'doc', content: [] }

  return {
    ok: true,
    value: {
      slug: input.slug,
      visibility,
      authorName: chosen.authorName,
      lang: chosen.lang,
      requestedLang: input.lang,
      title: chosen.title,
      summary: chosen.summary,
      doc,
      html: renderDocumentToHtml(doc),
      readingMinutes: readingTimeMinutes(doc),
      publishedAt: chosen.publishedAt,
      availableLangs: rows.map((row) => row.lang).sort(),
    },
  }
}

export type AuthoredArticle = {
  articleId: string
  slug: string
  status: string
  visibility: ArticleVisibility
  updatedAt: Date
  translations: Array<{ lang: string; title: string; status: string; updatedAt: Date }>
}

/** An author's own desk: everything they have started, newest first. */
export async function listAuthored(authorId: string): Promise<Array<AuthoredArticle>> {
  const { db } = await import('./db')
  const rows = await db
    .select({
      articleId: article.id,
      slug: article.slug,
      status: article.status,
      visibility: article.visibility,
      updatedAt: article.updatedAt,
      lang: articleTranslation.lang,
      title: articleTranslation.title,
      translationStatus: articleTranslation.status,
      translationUpdatedAt: articleTranslation.updatedAt,
    })
    .from(article)
    .leftJoin(articleTranslation, eq(articleTranslation.articleId, article.id))
    .where(eq(article.authorId, authorId))
    .orderBy(desc(article.updatedAt))

  const byArticle = new Map<string, AuthoredArticle>()
  for (const row of rows) {
    let entry = byArticle.get(row.articleId)
    if (!entry) {
      entry = {
        articleId: row.articleId,
        slug: row.slug,
        status: row.status,
        visibility: row.visibility,
        updatedAt: row.updatedAt,
        translations: [],
      }
      byArticle.set(row.articleId, entry)
    }
    if (row.lang) {
      entry.translations.push({
        lang: row.lang,
        title: row.title ?? '',
        status: row.translationStatus ?? 'draft',
        updatedAt: row.translationUpdatedAt ?? row.updatedAt,
      })
    }
  }
  return [...byArticle.values()]
}

export type EditableArticle = {
  articleId: string
  slug: string
  status: string
  visibility: ArticleVisibility
  authorId: string
  authorName: string
  lang: string
  title: string
  summary: string
  content: DocNode
  translationStatus: string
  otherLangs: Array<{ lang: string; status: string }>
}

/** One language of an article, open for editing. */
export async function getEditableArticle(input: {
  actor: Viewer
  articleId: string
  lang: string
}): Promise<ArticleResult<EditableArticle>> {
  const { db } = await import('./db')
  const [base] = await db
    .select({
      articleId: article.id,
      slug: article.slug,
      status: article.status,
      visibility: article.visibility,
      authorId: article.authorId,
      authorName: user.name,
    })
    .from(article)
    .innerJoin(user, eq(user.id, article.authorId))
    .where(eq(article.id, input.articleId))
    .limit(1)

  if (!base) return { ok: false, code: 'NOT_FOUND' }
  if (!canEdit(input.actor, base.authorId)) return { ok: false, code: 'FORBIDDEN' }

  const [translation] = await db
    .select({
      title: articleTranslation.title,
      summary: articleTranslation.summary,
      contentJson: articleTranslation.contentJson,
      status: articleTranslation.status,
    })
    .from(articleTranslation)
    .where(
      and(
        eq(articleTranslation.articleId, input.articleId),
        eq(articleTranslation.lang, input.lang),
      ),
    )
    .limit(1)

  const others = await db
    .select({ lang: articleTranslation.lang, status: articleTranslation.status })
    .from(articleTranslation)
    .where(
      and(
        eq(articleTranslation.articleId, input.articleId),
        ne(articleTranslation.lang, input.lang),
      ),
    )

  const parsed = translation ? parseDocument(translation.contentJson) : null

  return {
    ok: true,
    value: {
      ...base,
      lang: input.lang,
      title: translation?.title ?? '',
      summary: translation?.summary ?? '',
      // A language that does not exist yet opens as a blank page rather than a
      // 404: adding Creole to an article is starting to write, not an error.
      content: parsed?.ok ? parsed.doc : { type: 'doc', content: [] },
      translationStatus: translation?.status ?? 'new',
      otherLangs: others,
    },
  }
}

/** The saved versions of one language, newest first. */
export async function listRevisions(input: {
  actor: Viewer
  articleId: string
  lang: string
  limit?: number
}): Promise<
  ArticleResult<
    Array<{ id: string; title: string; createdAt: Date; createdBy: string | null }>
  >
> {
  const { db } = await import('./db')
  const [base] = await db
    .select({ authorId: article.authorId })
    .from(article)
    .where(eq(article.id, input.articleId))
    .limit(1)

  if (!base) return { ok: false, code: 'NOT_FOUND' }
  if (!canEdit(input.actor, base.authorId)) return { ok: false, code: 'FORBIDDEN' }

  const rows = await db
    .select({
      id: articleRevision.id,
      title: articleRevision.title,
      createdAt: articleRevision.createdAt,
      createdBy: articleRevision.createdBy,
    })
    .from(articleRevision)
    .where(
      and(
        eq(articleRevision.articleId, input.articleId),
        eq(articleRevision.lang, input.lang),
      ),
    )
    .orderBy(desc(articleRevision.createdAt))
    .limit(input.limit ?? 50)

  return { ok: true, value: rows }
}

/** Words in a document, for the author's own sense of length. */
export function wordCount(doc: DocNode): number {
  return docToPlainText(doc).split(/\s+/).filter(Boolean).length
}

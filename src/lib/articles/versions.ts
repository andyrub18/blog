import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, max } from 'drizzle-orm'
import {
  article,
  articleCompanion,
  articleRevision,
  articleTranslation,
  articleVersion,
  type VersionOutcome,
} from '../db/schema'
import { canRead, type Viewer } from './articles'
import { type DiffLabels, type DocumentDiff, diffDocuments, diffText } from './diff'
import { type DocNode, parseDocument, renderDocument } from './prosemirror'

/**
 * Versions: what the circle was given, what it decided, and what readers see
 * (D31).
 *
 * **Server only.** A version is made when a language is submitted, freezing the
 * text and the companion PDF together; the round's decision approves or refuses
 * it; and a language's published version is the highest approved one, which
 * `decide()` pins because decisions come in submission order.
 *
 * Two comparisons are built here, deliberately different:
 *
 * - **For the circle**, version *n* against version *n − 1* whatever became of
 *   it. That is what a contradictor needs: what the author changed in answer to
 *   the objections, even — especially — when the last round refused.
 * - **For readers**, each approved version against the previous *approved* one.
 *   A refused version was never published, and comparing against it would put
 *   the refused text on a public page as the "removed" side of a change.
 */

type Db = Awaited<typeof import('../db')>['db']
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

async function newestRevision(db: Db | Tx, articleId: string, lang: string) {
  const [row] = await db
    .select({ id: articleRevision.id })
    .from(articleRevision)
    .where(and(eq(articleRevision.articleId, articleId), eq(articleRevision.lang, lang)))
    .orderBy(desc(articleRevision.createdAt), desc(articleRevision.id))
    .limit(1)
  return row?.id ?? null
}

/**
 * Make the next version of each submitted language. Returns false — and makes
 * nothing — if a language has no saved text to freeze.
 *
 * The companion goes into the version only if it was made from exactly the text
 * being submitted. One made from an earlier draft describes something the
 * circle is not being asked to approve.
 */
export async function createVersions(
  db: Db | Tx,
  submission: { id: string | null; articleId: string },
  langs: Array<string>,
  now: Date,
): Promise<boolean> {
  const rows: Array<typeof articleVersion.$inferInsert> = []
  for (const lang of langs) {
    const revisionId = await newestRevision(db, submission.articleId, lang)
    if (!revisionId) return false
    const [{ highest }] = await db
      .select({ highest: max(articleVersion.number) })
      .from(articleVersion)
      .where(
        and(
          eq(articleVersion.articleId, submission.articleId),
          eq(articleVersion.lang, lang),
        ),
      )
    // The author's current PDF, if it was made from this text.
    const [companion] = await db
      .select({ id: articleCompanion.id })
      .from(articleCompanion)
      .where(
        and(
          eq(articleCompanion.articleId, submission.articleId),
          eq(articleCompanion.lang, lang),
          eq(articleCompanion.revisionId, revisionId),
          isNull(articleCompanion.supersededAt),
        ),
      )
      .limit(1)
    rows.push({
      id: randomUUID(),
      articleId: submission.articleId,
      lang,
      number: (highest ?? 0) + 1,
      submissionId: submission.id,
      revisionId,
      companionId: companion?.id ?? null,
      outcome: 'pending',
      createdAt: now,
    })
  }
  if (rows.length > 0) await db.insert(articleVersion).values(rows)
  return true
}

/**
 * Record a round's decision on its versions, inside `decide()`'s transaction.
 * Accepted languages are published at their version; the others are refused.
 */
export async function settleVersions(
  tx: Tx,
  submissionId: string,
  accepted: Array<string>,
  now: Date,
): Promise<void> {
  const versions = await tx
    .select({
      id: articleVersion.id,
      articleId: articleVersion.articleId,
      lang: articleVersion.lang,
    })
    .from(articleVersion)
    .where(eq(articleVersion.submissionId, submissionId))
  for (const version of versions) {
    const approved = accepted.includes(version.lang)
    await tx
      .update(articleVersion)
      .set({ outcome: approved ? 'approved' : 'refused', decidedAt: now })
      .where(eq(articleVersion.id, version.id))
    if (!approved) continue
    // The highest approved version: decisions come in submission order — one
    // open round per article at a time — so the version approved now is the
    // newest approved one.
    await tx
      .update(articleTranslation)
      .set({
        status: 'published',
        publishedAt: now,
        publishedVersionId: version.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(articleTranslation.articleId, version.articleId),
          eq(articleTranslation.lang, version.lang),
        ),
      )
  }
}

/** A round taken back before the circle decided: its versions keep their numbers. */
export async function withdrawVersions(tx: Tx, submissionId: string): Promise<void> {
  await tx
    .update(articleVersion)
    .set({ outcome: 'withdrawn' })
    .where(
      and(
        eq(articleVersion.submissionId, submissionId),
        eq(articleVersion.outcome, 'pending'),
      ),
    )
}

type VersionRow = {
  id: string
  number: number
  outcome: VersionOutcome
  createdAt: Date
  decidedAt: Date | null
  title: string
  summary: string
  contentJson: unknown
  companionId: string | null
  companionSha256: string | null
  companionPages: number | null
  companionBytes: number | null
}

async function versionsOf(
  db: Db,
  articleId: string,
  lang: string,
): Promise<Array<VersionRow>> {
  return db
    .select({
      id: articleVersion.id,
      number: articleVersion.number,
      outcome: articleVersion.outcome,
      createdAt: articleVersion.createdAt,
      decidedAt: articleVersion.decidedAt,
      title: articleRevision.title,
      summary: articleRevision.summary,
      contentJson: articleRevision.contentJson,
      companionId: articleVersion.companionId,
      companionSha256: articleCompanion.sha256,
      companionPages: articleCompanion.pageCount,
      companionBytes: articleCompanion.byteSize,
    })
    .from(articleVersion)
    .innerJoin(articleRevision, eq(articleRevision.id, articleVersion.revisionId))
    .leftJoin(articleCompanion, eq(articleCompanion.id, articleVersion.companionId))
    .where(and(eq(articleVersion.articleId, articleId), eq(articleVersion.lang, lang)))
    .orderBy(asc(articleVersion.number))
}

const docOf = (value: unknown): DocNode => {
  const parsed = parseDocument(value)
  return parsed.ok ? parsed.doc : { type: 'doc', content: [] }
}

export type PdfChange = 'none' | 'unchanged' | 'changed' | 'added' | 'removed'

function pdfChange(before: VersionRow | null, after: VersionRow): PdfChange {
  if (!before) return after.companionId ? 'added' : 'none'
  if (!before.companionSha256 && !after.companionSha256) return 'none'
  if (!before.companionSha256) return 'added'
  if (!after.companionSha256) return 'removed'
  return before.companionSha256 === after.companionSha256 ? 'unchanged' : 'changed'
}

export type Comparison = {
  /** Null for a first version: there is nothing before it to compare with. */
  previous: { number: number; outcome: VersionOutcome } | null
  titleHtml: string | null
  summaryHtml: string | null
  body: DocumentDiff
  pdf: PdfChange
}

function compare(
  before: VersionRow | null,
  after: VersionRow,
  labels: DiffLabels,
): Comparison {
  return {
    previous: before ? { number: before.number, outcome: before.outcome } : null,
    titleHtml:
      before && before.title !== after.title ? diffText(before.title, after.title) : null,
    summaryHtml:
      before && before.summary !== after.summary
        ? diffText(before.summary, after.summary)
        : null,
    body: diffDocuments(
      before ? docOf(before.contentJson) : null,
      docOf(after.contentJson),
      labels,
    ),
    pdf: pdfChange(before, after),
  }
}

export type RoundLanguage = {
  lang: string
  number: number
  outcome: VersionOutcome
  title: string
  summary: string
  /** The submitted text in full, rendered like the reading view. */
  html: string
  /** The author has saved this language since submitting it. */
  changedSince: boolean
  companion: { pageCount: number; byteSize: number } | null
  /** Against the previous version, whatever the circle made of it. */
  comparison: Comparison
}

/** Each language of a round, for the circle: its version, and what it changed. */
export async function roundLanguages(
  submission: { id: string; articleId: string; langs: Array<string> },
  labels: DiffLabels,
): Promise<Array<RoundLanguage>> {
  const { db } = await import('../db')
  const result: Array<RoundLanguage> = []
  for (const lang of submission.langs) {
    const versions = await versionsOf(db, submission.articleId, lang)
    const [mine] = await db
      .select({ id: articleVersion.id, revisionId: articleVersion.revisionId })
      .from(articleVersion)
      .where(
        and(
          eq(articleVersion.submissionId, submission.id),
          eq(articleVersion.lang, lang),
        ),
      )
      .limit(1)
    if (!mine) continue
    const at = versions.findIndex((version) => version.id === mine.id)
    const version = versions[at]
    const previous = at > 0 ? versions[at - 1] : null
    const newest = await newestRevision(db, submission.articleId, lang)
    result.push({
      lang,
      number: version.number,
      outcome: version.outcome,
      title: version.title,
      summary: version.summary,
      html: renderDocument(docOf(version.contentJson)).html,
      changedSince: newest !== mine.revisionId,
      companion:
        version.companionPages !== null && version.companionBytes !== null
          ? { pageCount: version.companionPages, byteSize: version.companionBytes }
          : null,
      comparison: compare(previous, version, labels),
    })
  }
  return result
}

export type HistoryEntry = {
  number: number
  approvedAt: Date | null
  title: string
  /** Against the previous approved version. */
  comparison: Comparison
}

export type History = {
  articleId: string
  slug: string
  lang: string
  title: string
  entries: Array<HistoryEntry>
}

/**
 * A language's approved versions, newest first, for readers.
 *
 * Refused and withdrawn versions are not listed and never compared against:
 * their text was not published. Their numbers still count, which is why the
 * page says the numbering can skip.
 */
export async function readerHistory(input: {
  slug: string
  lang: string
  viewer: Viewer | null
  labels: DiffLabels
}): Promise<
  { ok: true; value: History } | { ok: false; code: 'NOT_FOUND' | 'FORBIDDEN' }
> {
  const { db } = await import('../db')
  const translations = await db
    .select({
      articleId: article.id,
      visibility: article.visibility,
      lang: articleTranslation.lang,
    })
    .from(article)
    .innerJoin(articleTranslation, eq(articleTranslation.articleId, article.id))
    .where(
      and(
        eq(article.slug, input.slug),
        eq(article.status, 'published'),
        eq(articleTranslation.status, 'published'),
      ),
    )
  if (translations.length === 0) return { ok: false, code: 'NOT_FOUND' }
  if (!canRead(translations[0].visibility, input.viewer))
    return { ok: false, code: 'FORBIDDEN' }

  const { DEFAULT_LOCALE } = await import('../../i18n')
  const chosen =
    translations.find((t) => t.lang === input.lang) ??
    translations.find((t) => t.lang === DEFAULT_LOCALE) ??
    translations[0]

  const approved = (await versionsOf(db, chosen.articleId, chosen.lang)).filter(
    (version) => version.outcome === 'approved',
  )
  const entries = approved.map((version, i) => ({
    number: version.number,
    approvedAt: version.decidedAt,
    title: version.title,
    comparison: compare(i > 0 ? approved[i - 1] : null, version, input.labels),
  }))
  return {
    ok: true,
    value: {
      articleId: chosen.articleId,
      slug: input.slug,
      lang: chosen.lang,
      title: approved.at(-1)?.title ?? '',
      entries: entries.reverse(),
    },
  }
}

/** Which languages of an article have ever had a version: for the queue and tests. */
export async function versionNumbers(articleId: string, langs: Array<string>) {
  const { db } = await import('../db')
  return db
    .select({
      lang: articleVersion.lang,
      number: articleVersion.number,
      outcome: articleVersion.outcome,
    })
    .from(articleVersion)
    .where(
      and(eq(articleVersion.articleId, articleId), inArray(articleVersion.lang, langs)),
    )
    .orderBy(asc(articleVersion.lang), asc(articleVersion.number))
}

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { ArticleVisibility } from '../../db/schema'
import {
  article,
  articleCompanion,
  articleRevision,
  articleSubmission,
  articleTranslation,
  articleVersion,
  hasAtLeastRole,
} from '../../db/schema'
import { canEdit, canRead, type Viewer } from '../articles'
import { type PdfCleaning, type PdfError, preparePdf } from './pdf'

/**
 * Companion PDFs: attaching, replacing, removing and serving them (D24, D26).
 *
 * **Server only.** Reaches the filesystem, the database and `pdf-lib`.
 *
 * A companion reaches readers as part of a **version** (D31). Submitting a
 * language freezes its text and — if the author's current PDF was made from
 * that text — its PDF into the next version; the round's decision approves or
 * refuses the pair together; and readers are given the PDF of the published
 * version. `servableCompanion` below is the one place that is decided, and both
 * the reading view's link and the download route go through it.
 *
 * What the author attaches here is therefore a *working* PDF, the one the next
 * version will carry. Replacing it does not touch what readers have: the
 * published version keeps its own file, and a file stays on disk for as long as
 * any version refers to it.
 *
 * Downloads are deliberately **not** logged. A dossier read is logged because it
 * is a privileged look at somebody's private file; this is a reader taking a
 * public document home, and a list of who downloaded a political proposal is
 * exactly the list the movement's adversaries would want. The accountable act
 * is the upload, and that is recorded on the row.
 */

export type CompanionError =
  | PdfError
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NO_TEXT'
  | 'UNEXPECTED'

export type CompanionResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: CompanionError }

export type CompanionSummary = {
  byteSize: number
  pageCount: number
  uploadedAt: Date
}

/**
 * What the author's editor shows about the working PDF of one language.
 *
 * - `inReview` — it is part of the version the circle is reviewing now.
 * - `nextRound` — a round is open on this language, but this file is not the
 *   one in its version (it came later, or replaced it): it will go with the
 *   next version.
 * - `awaitingReview` — no round is open: it goes with the next version.
 * - `stale` — it was made from an earlier text than the author's current one,
 *   so no version will carry it. Only a new PDF can replace it.
 */
export type CompanionStatus = 'inReview' | 'nextRound' | 'awaitingReview' | 'stale'

export type CompanionState = {
  working: { state: 'none' } | ({ state: CompanionStatus } & CompanionSummary)
  /** The PDF readers are given: the published version's. */
  published: { version: number; pageCount: number; byteSize: number } | null
}

/** Read at call time so the database tests can point it at a temporary directory. */
function uploadRoot(): string {
  return process.env.UPLOAD_ROOT ?? join(process.cwd(), 'uploads')
}

/** Resolve a stored path, refusing anything that escapes the upload root. */
function resolveStored(storagePath: string): string | null {
  const root = uploadRoot()
  const absolute = normalize(join(root, storagePath))
  return absolute.startsWith(root + sep) ? absolute : null
}

async function discard(storagePath: string | null | undefined): Promise<void> {
  if (!storagePath) return
  const absolute = resolveStored(storagePath)
  if (absolute) await rm(absolute, { force: true })
}

type Db = Awaited<typeof import('../../db')>['db']
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** The newest revision of one language: the text a reader is shown. */
async function latestRevisionId(
  db: Db | Tx,
  articleId: string,
  lang: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: articleRevision.id })
    .from(articleRevision)
    .where(and(eq(articleRevision.articleId, articleId), eq(articleRevision.lang, lang)))
    .orderBy(desc(articleRevision.createdAt), desc(articleRevision.id))
    .limit(1)
  return row?.id ?? null
}

/**
 * The current companion of one language, whether or not it is still servable.
 */
async function currentCompanion(db: Db | Tx, articleId: string, lang: string) {
  const [row] = await db
    .select()
    .from(articleCompanion)
    .where(
      and(
        eq(articleCompanion.articleId, articleId),
        eq(articleCompanion.lang, lang),
        isNull(articleCompanion.supersededAt),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * The companion readers may be given for one language, or null: the PDF of the
 * published version (D31). One query, so the answer cannot be assembled from two
 * reads that straddle a decision.
 */
export async function servableCompanion(articleId: string, lang: string) {
  const { db } = await import('../../db')
  const [row] = await db
    .select({
      id: articleCompanion.id,
      storagePath: articleCompanion.storagePath,
      byteSize: articleCompanion.byteSize,
      pageCount: articleCompanion.pageCount,
      sha256: articleCompanion.sha256,
      version: articleVersion.number,
    })
    .from(articleTranslation)
    .innerJoin(
      articleVersion,
      eq(articleVersion.id, articleTranslation.publishedVersionId),
    )
    .innerJoin(articleCompanion, eq(articleCompanion.id, articleVersion.companionId))
    .where(
      and(
        eq(articleTranslation.articleId, articleId),
        eq(articleTranslation.lang, lang),
        eq(articleTranslation.status, 'published'),
        isNotNull(articleCompanion.storagePath),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Whether any version carries this file — and so whether its bytes must stay. */
async function inAnyVersion(db: Db | Tx, companionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: articleVersion.id })
    .from(articleVersion)
    .where(eq(articleVersion.companionId, companionId))
    .limit(1)
  return row !== undefined
}

async function loadEditable(actor: Viewer, articleId: string) {
  const { db } = await import('../../db')
  const [row] = await db
    .select({ id: article.id, authorId: article.authorId })
    .from(article)
    .where(eq(article.id, articleId))
    .limit(1)
  if (!row) return { ok: false as const, code: 'NOT_FOUND' as const }
  if (!canEdit(actor, row.authorId))
    return { ok: false as const, code: 'FORBIDDEN' as const }
  return { ok: true as const, db }
}

/**
 * Attach a PDF to one language, replacing any companion it already has.
 *
 * It is tied to the newest revision **as saved**. An author with unsaved edits
 * in the editor is attaching a PDF of the text before those edits, and the next
 * save will retire it — which is the rule doing its job, and why the panel asks
 * them to save first.
 */
export async function attachCompanion(input: {
  actor: Viewer
  articleId: string
  lang: string
  file: File | null
}): Promise<CompanionResult<CompanionSummary & { cleaning: PdfCleaning }>> {
  // Authorised before the file is parsed: an unauthorised caller should not be
  // able to make the server spend anything on their upload.
  const editable = await loadEditable(input.actor, input.articleId)
  if (!editable.ok) return editable
  const { db } = editable

  const [translation] = await db
    .select({ title: articleTranslation.title })
    .from(articleTranslation)
    .where(
      and(
        eq(articleTranslation.articleId, input.articleId),
        eq(articleTranslation.lang, input.lang),
      ),
    )
    .limit(1)
  // A companion of a language that has no text would be the only version of
  // it, which is the PDF-instead-of-an-article that D24 refused.
  if (!translation) return { ok: false, code: 'NO_TEXT' }

  const prepared = await preparePdf(input.file, translation.title)
  if (!prepared.ok) return prepared

  const { bytes, pageCount, cleaning } = prepared.value
  const storagePath = `companions/${input.articleId}/${input.lang}-${randomUUID()}.pdf`
  const absolute = resolveStored(storagePath)
  if (!absolute) return { ok: false, code: 'UNEXPECTED' }
  await mkdir(join(uploadRoot(), 'companions', input.articleId), { recursive: true })
  await writeFile(absolute, bytes)

  const now = new Date()
  let replaced: string | null = null
  try {
    await db.transaction(async (tx) => {
      // Read inside the transaction, so the revision recorded is the one that
      // was newest when the companion became current.
      const revisionId = await latestRevisionId(tx, input.articleId, input.lang)
      if (!revisionId) throw new NoText()

      const previous = await currentCompanion(tx, input.articleId, input.lang)
      if (previous) {
        // A file a version carries is part of the record — the published one is
        // being served — so only a file no version refers to is let go.
        const keep = await inAnyVersion(tx, previous.id)
        if (!keep) replaced = previous.storagePath
        await tx
          .update(articleCompanion)
          .set({
            supersededAt: now,
            supersededBy: input.actor.id,
            ...(keep ? {} : { storagePath: null }),
          })
          .where(eq(articleCompanion.id, previous.id))
      }

      await tx.insert(articleCompanion).values({
        id: randomUUID(),
        articleId: input.articleId,
        lang: input.lang,
        revisionId,
        storagePath,
        byteSize: bytes.byteLength,
        pageCount,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        uploadedBy: input.actor.id,
        uploadedAt: now,
      })
    })
  } catch (err) {
    // Nothing references the new file; it must not outlive the failed attempt.
    await discard(storagePath)
    if (err instanceof NoText) return { ok: false, code: 'NO_TEXT' }
    // Includes the unique index refusing a second current companion when two
    // uploads for the same language race: one wins, the other is told to retry.
    return { ok: false, code: 'UNEXPECTED' }
  }

  // After the commit, never before: if the transaction had failed, the old
  // file would still be the current one.
  await discard(replaced)

  return {
    ok: true,
    value: { byteSize: bytes.byteLength, pageCount, uploadedAt: now, cleaning },
  }
}

class NoText extends Error {}

/**
 * Take the working PDF away, so the next version carries none. The row is
 * closed, not deleted, and a file a version carries keeps its bytes: removing
 * the working PDF does not withdraw the published one.
 */
export async function removeCompanion(input: {
  actor: Viewer
  articleId: string
  lang: string
}): Promise<CompanionResult<null>> {
  const editable = await loadEditable(input.actor, input.articleId)
  if (!editable.ok) return editable
  const { db } = editable

  const current = await currentCompanion(db, input.articleId, input.lang)
  if (!current) return { ok: false, code: 'NOT_FOUND' }

  const keep = await inAnyVersion(db, current.id)
  await db
    .update(articleCompanion)
    .set({
      supersededAt: new Date(),
      supersededBy: input.actor.id,
      ...(keep ? {} : { storagePath: null }),
    })
    .where(eq(articleCompanion.id, current.id))
  if (!keep) await discard(current.storagePath)
  return { ok: true, value: null }
}

/** What the editor shows for one language. Same permission as editing the text. */
export async function companionState(input: {
  actor: Viewer
  articleId: string
  lang: string
}): Promise<CompanionResult<CompanionState>> {
  const editable = await loadEditable(input.actor, input.articleId)
  if (!editable.ok) return editable
  const { db } = editable

  const served = await servableCompanion(input.articleId, input.lang)
  const published = served
    ? { version: served.version, pageCount: served.pageCount, byteSize: served.byteSize }
    : null

  const current = await currentCompanion(db, input.articleId, input.lang)
  if (!current) return { ok: true, value: { working: { state: 'none' }, published } }
  const summary = {
    byteSize: current.byteSize,
    pageCount: current.pageCount,
    uploadedAt: current.uploadedAt,
  }

  // A version can only carry a PDF made from the text it freezes, which is the
  // author's newest text.
  const latest = await latestRevisionId(db, input.articleId, input.lang)
  if (latest !== current.revisionId) {
    return { ok: true, value: { working: { state: 'stale', ...summary }, published } }
  }

  const [open] = await db
    .select({ companionId: articleVersion.companionId })
    .from(articleVersion)
    .innerJoin(articleSubmission, eq(articleSubmission.id, articleVersion.submissionId))
    .where(
      and(
        eq(articleVersion.articleId, input.articleId),
        eq(articleVersion.lang, input.lang),
        inArray(articleSubmission.status, ['open', 'in_review']),
      ),
    )
    .limit(1)
  const state: CompanionStatus = !open
    ? 'awaitingReview'
    : open.companionId === current.id
      ? 'inReview'
      : 'nextRound'
  return { ok: true, value: { working: { state, ...summary }, published } }
}

/** Stream a stored file, or null if it is missing or escapes the upload root. */
async function streamStored(
  storagePath: string,
): Promise<ReadableStream<Uint8Array> | null> {
  const absolute = resolveStored(storagePath)
  if (!absolute) return null
  try {
    await stat(absolute)
  } catch {
    return null
  }
  // Streamed, not read into memory: a 20 MB file times a few readers at once
  // is not something the server should hold.
  return Readable.toWeb(createReadStream(absolute)) as ReadableStream<Uint8Array>
}

export type ReviewDownload =
  | { ok: true; body: ReadableStream<Uint8Array>; byteSize: number; filename: string }
  | { ok: false; status: 403 | 404 }

/**
 * A member's download of the PDF a round's version carries (D31).
 *
 * The same audience as the submission page itself: any member. The circle is
 * the movement's members, and the PDF is part of what they are deliberating on.
 * Not logged, for the same reason a reader's download is not: this is the
 * author's proposal, not somebody's private file.
 */
export async function openCompanionForReview(input: {
  submissionId: string
  lang: string
  viewer: Viewer | null
}): Promise<ReviewDownload> {
  const viewer = input.viewer
  if (
    !viewer ||
    viewer.memberStatus === 'blocked' ||
    !hasAtLeastRole(viewer.role, 'member')
  ) {
    return { ok: false, status: 403 }
  }
  const { db } = await import('../../db')
  const [row] = await db
    .select({
      storagePath: articleCompanion.storagePath,
      byteSize: articleCompanion.byteSize,
      number: articleVersion.number,
      slug: article.slug,
    })
    .from(articleVersion)
    .innerJoin(articleCompanion, eq(articleCompanion.id, articleVersion.companionId))
    .innerJoin(article, eq(article.id, articleVersion.articleId))
    .where(
      and(
        eq(articleVersion.submissionId, input.submissionId),
        eq(articleVersion.lang, input.lang),
      ),
    )
    .limit(1)
  const body = row?.storagePath ? await streamStored(row.storagePath) : null
  if (!row || !body) return { ok: false, status: 404 }
  return {
    ok: true,
    body,
    byteSize: row.byteSize,
    filename: `${row.slug}-${input.lang}-v${row.number}.pdf`,
  }
}

export type CompanionDownload =
  | {
      ok: true
      body: ReadableStream<Uint8Array>
      byteSize: number
      sha256: string
      filename: string
      visibility: ArticleVisibility
    }
  | { ok: true; notModified: true; sha256: string; visibility: ArticleVisibility }
  | { ok: false; status: 403 | 404 }

/**
 * A reader's download of one language's companion.
 *
 * Refused with 404 — not 410, not a redirect — when the file is stale, so a
 * forwarded link to an outdated PDF gives nobody the outdated PDF.
 */
export async function openCompanionDownload(input: {
  slug: string
  lang: string
  viewer: Viewer | null
  ifNoneMatch?: string | null
}): Promise<CompanionDownload> {
  const { db } = await import('../../db')
  const [row] = await db
    .select({ articleId: article.id, visibility: article.visibility })
    .from(article)
    .innerJoin(articleTranslation, eq(articleTranslation.articleId, article.id))
    .where(
      and(
        eq(article.slug, input.slug),
        eq(article.status, 'published'),
        eq(articleTranslation.lang, input.lang),
        eq(articleTranslation.status, 'published'),
      ),
    )
    .limit(1)
  if (!row) return { ok: false, status: 404 }
  if (!canRead(row.visibility, input.viewer)) return { ok: false, status: 403 }

  const companion = await servableCompanion(row.articleId, input.lang)
  if (!companion?.storagePath) return { ok: false, status: 404 }

  // The hash names the exact bytes, so a reader re-opening the link on metered
  // data is told "you already have it" instead of paying for it twice.
  if (input.ifNoneMatch?.includes(companion.sha256)) {
    return {
      ok: true,
      notModified: true,
      sha256: companion.sha256,
      visibility: row.visibility,
    }
  }

  const body = await streamStored(companion.storagePath)
  if (!body) return { ok: false, status: 404 }

  return {
    ok: true,
    body,
    byteSize: companion.byteSize,
    sha256: companion.sha256,
    filename: `${input.slug}-${input.lang}.pdf`,
    visibility: row.visibility,
  }
}

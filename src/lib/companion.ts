import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { canEdit, canRead, type Viewer } from './articles'
import type { ArticleVisibility } from './db/schema'
import {
  article,
  articleCompanion,
  articleRevision,
  articleTranslation,
} from './db/schema'
import { type PdfCleaning, type PdfError, preparePdf } from './pdf'

/**
 * Companion PDFs: attaching, replacing, removing and serving them (D24, D26).
 *
 * **Server only.** Reaches the filesystem, the database and `pdf-lib`.
 *
 * The rule the whole module turns on: a companion is offered only while it was
 * made from the text readers are looking at. `isServable` below is the one
 * place that is decided, and both the reading view's link and the download
 * route go through it, so the link can never point at a file the route would
 * refuse — or the other way round.
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
 * What the author's editor shows about one language's companion.
 *
 * `stale` is the state worth a sentence: the file is still held, but readers no
 * longer see it, because the text has been saved since. The author is the only
 * person who can fix that, and they will not know unless the editor says so.
 */
export type CompanionState =
  | { state: 'none' }
  | ({ state: 'current' | 'stale' } & CompanionSummary)

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

type Db = Awaited<typeof import('./db')>['db']
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
 * The companion readers may be given for one language, or null.
 *
 * Current, and made from the newest revision. One query, so the answer cannot
 * be assembled from two reads that straddle a save.
 */
export async function servableCompanion(articleId: string, lang: string) {
  const { db } = await import('./db')
  const [row] = await db
    .select()
    .from(articleCompanion)
    .where(
      and(
        eq(articleCompanion.articleId, articleId),
        eq(articleCompanion.lang, lang),
        isNull(articleCompanion.supersededAt),
        eq(
          articleCompanion.revisionId,
          sql`(select ${articleRevision.id} from ${articleRevision}
               where ${articleRevision.articleId} = ${articleId}
                 and ${articleRevision.lang} = ${lang}
               order by ${articleRevision.createdAt} desc, ${articleRevision.id} desc
               limit 1)`,
        ),
      ),
    )
    .limit(1)
  return row ?? null
}

async function loadEditable(actor: Viewer, articleId: string) {
  const { db } = await import('./db')
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
        replaced = previous.storagePath
        await tx
          .update(articleCompanion)
          .set({ supersededAt: now, supersededBy: input.actor.id, storagePath: null })
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

/** Stop offering a language's companion. The row is closed, not deleted. */
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

  await db
    .update(articleCompanion)
    .set({ supersededAt: new Date(), supersededBy: input.actor.id, storagePath: null })
    .where(eq(articleCompanion.id, current.id))
  await discard(current.storagePath)
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

  const current = await currentCompanion(db, input.articleId, input.lang)
  if (!current) return { ok: true, value: { state: 'none' } }
  const latest = await latestRevisionId(db, input.articleId, input.lang)
  return {
    ok: true,
    value: {
      state: latest === current.revisionId ? 'current' : 'stale',
      byteSize: current.byteSize,
      pageCount: current.pageCount,
      uploadedAt: current.uploadedAt,
    },
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
  const { db } = await import('./db')
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

  const absolute = resolveStored(companion.storagePath)
  if (!absolute) return { ok: false, status: 404 }
  try {
    await stat(absolute)
  } catch {
    return { ok: false, status: 404 }
  }

  return {
    ok: true,
    // Streamed, not read into memory: a 20 MB file times a few readers at once
    // is not something the server should hold.
    body: Readable.toWeb(createReadStream(absolute)) as ReadableStream<Uint8Array>,
    byteSize: companion.byteSize,
    sha256: companion.sha256,
    filename: `${input.slug}-${input.lang}.pdf`,
    visibility: row.visibility,
  }
}

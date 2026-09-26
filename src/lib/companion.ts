import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  type SQL,
  sql,
} from 'drizzle-orm'
import { canEdit, canRead, type Viewer } from './articles'
import type { ArticleVisibility } from './db/schema'
import {
  article,
  articleCompanion,
  articleRevision,
  articleSubmission,
  articleTranslation,
  hasAtLeastRole,
} from './db/schema'
import { type PdfCleaning, type PdfError, preparePdf } from './pdf'

/**
 * Companion PDFs: attaching, replacing, removing and serving them (D24, D26).
 *
 * **Server only.** Reaches the filesystem, the database and `pdf-lib`.
 *
 * The rule the whole module turns on: a companion is offered only while it was
 * made from the text readers are looking at, **and only once the circle has
 * approved it** (D29). `servableCompanion` below is the one place that is
 * decided, and both the reading view's link and the download route go through
 * it, so the link can never point at a file the route would refuse — or the
 * other way round.
 *
 * Approval happens in `decide()`, through `approveCompanions`: when a language
 * is accepted, the companion attached *before that round was submitted*, and
 * still made from the newest text, is stamped with the round. The circle can
 * only vouch for a file it was given to read, so one attached after submission
 * — a replacement after publication included — waits for the next round.
 * Reviewers read it through `reviewCompanions` and `openCompanionForReview`.
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
 * - `approved` — the circle approved it and it matches the text: readers get it
 *   while the language is published.
 * - `inReview` — attached before the round now open on this language: the
 *   circle is reading it with the text.
 * - `nextRound` — attached after that round was submitted: the circle is not
 *   reviewing it, and it will wait for the next round.
 * - `awaitingReview` — no round is open: it goes to the circle when this
 *   language is next submitted.
 * - `stale` — the text was saved after it was attached. Readers never get it,
 *   and no round will approve it; only a new PDF can replace it.
 *
 * Every state but `approved` means readers do not have it, and the editor says
 * which, because the author is the only person who can act on it.
 */
export type CompanionStatus =
  | 'approved'
  | 'inReview'
  | 'nextRound'
  | 'awaitingReview'
  | 'stale'

export type CompanionState =
  | { state: 'none' }
  | ({ state: CompanionStatus } & CompanionSummary)

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

/** The id of the newest revision of one language, as a subquery. */
function newestRevision(
  articleId: string | SQL | typeof articleCompanion.articleId,
  lang: string | SQL | typeof articleCompanion.lang,
) {
  return sql`(select ${articleRevision.id} from ${articleRevision}
               where ${articleRevision.articleId} = ${articleId}
                 and ${articleRevision.lang} = ${lang}
               order by ${articleRevision.createdAt} desc, ${articleRevision.id} desc
               limit 1)`
}

/**
 * The companion readers may be given for one language, or null.
 *
 * Current, made from the newest revision, and approved by the circle. One
 * query, so the answer cannot be assembled from two reads that straddle a save.
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
        isNotNull(articleCompanion.approvedInSubmissionId),
        eq(articleCompanion.revisionId, newestRevision(articleId, lang)),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * Stamp the companions a decision approves. Called by `decide()`, inside its
 * transaction, with the languages the circle accepted.
 *
 * Approved: the current companion of an accepted language, attached no later
 * than the round was submitted, and still made from the newest text — the file
 * the circle was given to read, describing the text it accepted. Anything else
 * is left unapproved and says so in the author's editor.
 */
export async function approveCompanions(
  tx: Tx,
  submission: { id: string; articleId: string; submittedAt: Date },
  langs: Array<string>,
  now: Date,
): Promise<void> {
  if (langs.length === 0) return
  await tx
    .update(articleCompanion)
    .set({ approvedInSubmissionId: submission.id, approvedAt: now })
    .where(
      and(
        eq(articleCompanion.articleId, submission.articleId),
        inArray(articleCompanion.lang, langs),
        isNull(articleCompanion.supersededAt),
        isNull(articleCompanion.approvedInSubmissionId),
        lte(articleCompanion.uploadedAt, submission.submittedAt),
        eq(
          articleCompanion.revisionId,
          newestRevision(articleCompanion.articleId, articleCompanion.lang),
        ),
      ),
    )
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
  const summary = {
    byteSize: current.byteSize,
    pageCount: current.pageCount,
    uploadedAt: current.uploadedAt,
  }

  const latest = await latestRevisionId(db, input.articleId, input.lang)
  if (latest !== current.revisionId)
    return { ok: true, value: { state: 'stale', ...summary } }
  if (current.approvedInSubmissionId) {
    return { ok: true, value: { state: 'approved', ...summary } }
  }

  const [open] = await db
    .select({
      submittedAt: articleSubmission.submittedAt,
      langs: articleSubmission.langs,
    })
    .from(articleSubmission)
    .where(
      and(
        eq(articleSubmission.articleId, input.articleId),
        inArray(articleSubmission.status, ['open', 'in_review']),
      ),
    )
    .limit(1)
  const state: CompanionStatus = !open?.langs.includes(input.lang)
    ? 'awaitingReview'
    : current.uploadedAt <= open.submittedAt
      ? 'inReview'
      : 'nextRound'
  return { ok: true, value: { state, ...summary } }
}

/**
 * What reviewers are shown about each language of a round.
 *
 * - `underReview` — the file this round is reviewing; they can download it.
 * - `approved` — the file this round's decision approved.
 * - `afterSubmission` — a PDF exists, but was attached after the round was
 *   submitted. Not theirs to review; saying so stops a reviewer from assuming
 *   the absence of a download means there is no PDF.
 * - `stale` — the text changed after the PDF was attached, so it cannot be
 *   approved whatever the circle decides.
 */
export type ReviewCompanion =
  | { lang: string; state: 'none' }
  | {
      lang: string
      state: 'underReview' | 'approved' | 'afterSubmission' | 'stale'
      pageCount: number
      byteSize: number
    }

export async function reviewCompanions(submission: {
  id: string
  articleId: string
  langs: Array<string>
  submittedAt: Date
}): Promise<Array<ReviewCompanion>> {
  const { db } = await import('./db')
  return Promise.all(
    submission.langs.map(async (lang): Promise<ReviewCompanion> => {
      const [approvedHere] = await db
        .select()
        .from(articleCompanion)
        .where(
          and(
            eq(articleCompanion.articleId, submission.articleId),
            eq(articleCompanion.lang, lang),
            eq(articleCompanion.approvedInSubmissionId, submission.id),
          ),
        )
        .limit(1)
      if (approvedHere) {
        return {
          lang,
          state: 'approved',
          pageCount: approvedHere.pageCount,
          byteSize: approvedHere.byteSize,
        }
      }

      const current = await currentCompanion(db, submission.articleId, lang)
      if (!current) return { lang, state: 'none' }
      const sizes = { pageCount: current.pageCount, byteSize: current.byteSize }
      const latest = await latestRevisionId(db, submission.articleId, lang)
      if (latest !== current.revisionId) return { lang, state: 'stale', ...sizes }
      if (current.uploadedAt > submission.submittedAt) {
        return { lang, state: 'afterSubmission', ...sizes }
      }
      return { lang, state: 'underReview', ...sizes }
    }),
  )
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
 * A member's download of the PDF a round is reviewing — or approved.
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
  const { db } = await import('./db')
  const [submission] = await db
    .select({
      id: articleSubmission.id,
      articleId: articleSubmission.articleId,
      langs: articleSubmission.langs,
      submittedAt: articleSubmission.submittedAt,
      slug: article.slug,
    })
    .from(articleSubmission)
    .innerJoin(article, eq(article.id, articleSubmission.articleId))
    .where(eq(articleSubmission.id, input.submissionId))
    .limit(1)
  if (!submission?.langs.includes(input.lang)) return { ok: false, status: 404 }

  const [view] = await reviewCompanions({ ...submission, langs: [input.lang] })
  if (view.state !== 'underReview' && view.state !== 'approved') {
    return { ok: false, status: 404 }
  }
  const [row] = await db
    .select()
    .from(articleCompanion)
    .where(
      view.state === 'approved'
        ? and(
            eq(articleCompanion.articleId, submission.articleId),
            eq(articleCompanion.lang, input.lang),
            eq(articleCompanion.approvedInSubmissionId, submission.id),
          )
        : and(
            eq(articleCompanion.articleId, submission.articleId),
            eq(articleCompanion.lang, input.lang),
            isNull(articleCompanion.supersededAt),
          ),
    )
    .limit(1)
  const body = row?.storagePath ? await streamStored(row.storagePath) : null
  if (!row || !body) return { ok: false, status: 404 }
  return {
    ok: true,
    body,
    byteSize: row.byteSize,
    filename: `${submission.slug}-${input.lang}-round.pdf`,
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

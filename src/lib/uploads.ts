import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_PDF_BYTES } from './validation'

const UPLOAD_ROOT = join(process.cwd(), 'uploads')

/** `%PDF-` — the only thing that actually makes a file a PDF. */
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])

export type PdfUploadError = 'MISSING_FILE' | 'INVALID_TYPE' | 'FILE_TOO_LARGE'

export class UploadError extends Error {
  code: PdfUploadError
  constructor(code: PdfUploadError) {
    super(code)
    this.code = code
  }
}

export type ApplicationField = 'cv' | 'vision' | 'contribution'

/** A validated, in-memory PDF that has not been written to disk yet. */
export type StagedPdf = {
  field: ApplicationField
  bytes: Buffer
  safeName: string
}

/**
 * Reduce an uploaded filename to something safe to place on disk.
 *
 * Path separators are replaced, then runs of dots are collapsed so no `..`
 * survives. Traversal is already impossible because the result is a single
 * path segment joined under a per-user directory and always prefixed, but a
 * stored name containing `..` is noise nobody should have to reason about.
 */
function sanitizeName(name: string): string {
  const base = name
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.]+/, '')
    .slice(-80)
  return base.length > 0 ? base : 'file.pdf'
}

/**
 * Validate an uploaded PDF and hold it in memory.
 *
 * The MIME type reported by the browser is NOT trusted: `file.type` is set by
 * the client and is trivially spoofed. We check the leading bytes instead.
 *
 * Staging happens before any account is created, so a bad upload fails without
 * leaving a half-registered user behind.
 */
export async function stageApplicationPdf(
  field: ApplicationField,
  file: File | undefined | null,
): Promise<StagedPdf> {
  if (!file || typeof (file as File).arrayBuffer !== 'function' || file.size === 0) {
    throw new UploadError('MISSING_FILE')
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new UploadError('FILE_TOO_LARGE')
  }
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new UploadError('FILE_TOO_LARGE')
  }
  if (!bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    throw new UploadError('INVALID_TYPE')
  }
  return { field, bytes, safeName: sanitizeName(file.name) }
}

/** Write a staged PDF to its permanent location, returning its storage path. */
export async function commitApplicationPdf(
  userId: string,
  staged: StagedPdf,
): Promise<string> {
  const dir = join(UPLOAD_ROOT, 'member-applications', userId)
  await mkdir(dir, { recursive: true })
  const fileName = `${staged.field}-${randomUUID()}-${staged.safeName}`
  await writeFile(join(dir, fileName), staged.bytes)
  return `member-applications/${userId}/${fileName}`
}

/** Compensating cleanup when an application fails partway through. */
export async function discardApplicationUploads(userId: string): Promise<void> {
  await rm(join(UPLOAD_ROOT, 'member-applications', userId), {
    recursive: true,
    force: true,
  })
}

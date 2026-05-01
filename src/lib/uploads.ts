import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const UPLOAD_ROOT = join(process.cwd(), 'uploads')
const MAX_PDF_BYTES = 5 * 1024 * 1024

export type PdfUploadError =
  | 'MISSING_FILE'
  | 'INVALID_TYPE'
  | 'FILE_TOO_LARGE'

export class UploadError extends Error {
  code: PdfUploadError
  constructor(code: PdfUploadError) {
    super(code)
    this.code = code
  }
}

function sanitizeName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)
  return base.length > 0 ? base : 'file.pdf'
}

function assertPdf(file: File | undefined | null): asserts file is File {
  if (!file || typeof (file as File).arrayBuffer !== 'function') {
    throw new UploadError('MISSING_FILE')
  }
  if (file.type !== 'application/pdf') {
    throw new UploadError('INVALID_TYPE')
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new UploadError('FILE_TOO_LARGE')
  }
}

export async function saveMemberApplicationPdf(
  userId: string,
  field: 'cv' | 'vision' | 'contribution',
  file: File | undefined | null,
): Promise<string> {
  assertPdf(file)
  const dir = join(UPLOAD_ROOT, 'member-applications', userId)
  await mkdir(dir, { recursive: true })
  const safeName = sanitizeName(file.name)
  const fileName = `${field}-${randomUUID()}-${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(join(dir, fileName), buffer)
  return `member-applications/${userId}/${fileName}`
}

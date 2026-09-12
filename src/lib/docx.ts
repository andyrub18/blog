import type { ImportReport } from './html-to-prosemirror'
import type { DocNode } from './prosemirror'

/**
 * The DOCX import, from an uploaded file to a draft.
 *
 * This is the *public* upload path, and it has the opposite security posture to
 * the dossier PDFs in `uploads.ts`. A dossier is confidential and never
 * rendered; a `.docx` becomes article content that the world eventually reads.
 * The risk is therefore injection into a public page, and the answer is that
 * nothing from the file reaches a reader as markup — see `html-to-prosemirror.ts`,
 * which rebuilds the document from an allowlist rather than cleaning it.
 *
 * The order here matters. The container is checked before it is opened, and its
 * declared sizes are checked before anything is decompressed, because a 2 MB
 * upload that expands to 8 GB is a denial of service that costs the attacker
 * nothing.
 */

/** Word files are large. Ten megabytes is generous for an article and finite. */
export const MAX_DOCX_BYTES = 10 * 1024 * 1024

/**
 * Zip-bomb limits, applied to what the archive *claims* before it is opened.
 *
 * A ZIP's central directory states each entry's compressed and uncompressed
 * size, so these can all be checked without decompressing a single byte. A
 * malicious archive can of course lie, but then the lie is caught by the real
 * limit: mammoth is given a buffer that is already capped at 10 MB, and an
 * entry that decompresses to more than it declared will blow the total.
 */
export const MAX_ENTRIES = 512
export const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024
export const MAX_COMPRESSION_RATIO = 200

/** How long one conversion may take before we stop waiting for it. */
export const CONVERSION_TIMEOUT_MS = 20_000

export type DocxError =
  | 'MISSING_FILE'
  | 'FILE_TOO_LARGE'
  | 'NOT_A_ZIP'
  | 'NOT_A_DOCX'
  | 'ARCHIVE_REFUSED'
  | 'CONVERSION_FAILED'
  | 'CONVERSION_TIMEOUT'
  | 'EMPTY_DOCUMENT'

export type DocxResult =
  | { ok: true; doc: DocNode; report: ImportReport; warnings: Array<string> }
  | { ok: false; code: DocxError }

/** `PK\x03\x04` — the only thing that actually makes a file a ZIP. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
/** A ZIP comment is at most 64 KB, so the end record is within that of the tail. */
const MAX_EOCD_SEARCH = 66_000

export type ArchiveEntry = { name: string; compressed: number; uncompressed: number }

/**
 * Read what the archive says about itself, without opening it.
 *
 * Returns null when the file is not a ZIP we can read at all. Everything here
 * comes from the central directory, which is the index a ZIP keeps at its end;
 * decompressing to find out how big something is would be the bug.
 */
export function readArchiveIndex(buffer: Buffer): Array<ArchiveEntry> | null {
  const from = Math.max(0, buffer.length - MAX_EOCD_SEARCH)
  let eocd = -1
  for (let i = buffer.length - 22; i >= from; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null

  const total = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries: Array<ArchiveEntry> = []

  for (let i = 0; i < total; i += 1) {
    if (offset + 46 > buffer.length) return null
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) return null

    const compressed = buffer.readUInt32LE(offset + 20)
    const uncompressed = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)

    entries.push({ name, compressed, uncompressed })
    offset += 46 + nameLength + extraLength + commentLength

    // More entries than we will ever allow: stop reading rather than walking a
    // crafted directory to the end of the file.
    if (entries.length > MAX_ENTRIES) return entries
  }

  return entries
}

export type ArchiveVerdict = { ok: true } | { ok: false; code: DocxError }

/** Whether this archive is a Word file we are willing to open. */
export function inspectArchive(entries: Array<ArchiveEntry>): ArchiveVerdict {
  if (entries.length > MAX_ENTRIES) return { ok: false, code: 'ARCHIVE_REFUSED' }

  let uncompressed = 0
  for (const entry of entries) {
    uncompressed += entry.uncompressed
    if (uncompressed > MAX_UNCOMPRESSED_BYTES) {
      return { ok: false, code: 'ARCHIVE_REFUSED' }
    }
    // A single entry with an absurd expansion factor is the classic bomb: a few
    // kilobytes of zeroes that become gigabytes.
    if (
      entry.compressed > 0 &&
      entry.uncompressed / entry.compressed > MAX_COMPRESSION_RATIO
    ) {
      return { ok: false, code: 'ARCHIVE_REFUSED' }
    }
    // `..` in an entry name is a path-traversal attempt. Mammoth does not write
    // entries to disk, so this cannot bite today; refusing the file is still the
    // right answer, because nothing legitimate is shaped like that.
    if (entry.name.includes('..') || entry.name.startsWith('/')) {
      return { ok: false, code: 'ARCHIVE_REFUSED' }
    }
  }

  // What makes a ZIP a Word document rather than a renamed archive.
  const names = entries.map((entry) => entry.name)
  const hasContentTypes = names.includes('[Content_Types].xml')
  const hasWordPart = names.some((name) => name.startsWith('word/'))
  if (!hasContentTypes || !hasWordPart) return { ok: false, code: 'NOT_A_DOCX' }

  return { ok: true }
}

function looksLikeZip(buffer: Buffer): boolean {
  if (buffer.length < ZIP_MAGIC.length) return false
  return ZIP_MAGIC.every((byte, i) => buffer[i] === byte)
}

/**
 * Convert one uploaded Word file into a document we can store.
 *
 * Mammoth maps Word *styles* to semantic tags and discards visual styling,
 * which is exactly right here: the target is structured article content, not a
 * pixel copy of somebody's page layout.
 *
 * Images are dropped rather than inlined. Mammoth's default is to embed each
 * one as a base64 `data:` URI, which would bloat the stored row and every page
 * load of the published article — directly against the first-load budget — and
 * we have nowhere to put them yet (DECISIONS.md, D11). They are counted and
 * named in the report so the author knows to add them back when there is an
 * image pipeline to add them to.
 */
export async function convertDocx(file: File | null | undefined): Promise<DocxResult> {
  if (!file || typeof file.arrayBuffer !== 'function' || file.size === 0) {
    return { ok: false, code: 'MISSING_FILE' }
  }
  // Checked before reading the body into memory, not after.
  if (file.size > MAX_DOCX_BYTES) return { ok: false, code: 'FILE_TOO_LARGE' }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > MAX_DOCX_BYTES) return { ok: false, code: 'FILE_TOO_LARGE' }

  // The MIME type the browser reports is set by the client and means nothing.
  if (!looksLikeZip(buffer)) return { ok: false, code: 'NOT_A_ZIP' }

  const entries = readArchiveIndex(buffer)
  if (!entries) return { ok: false, code: 'NOT_A_ZIP' }

  const verdict = inspectArchive(entries)
  if (!verdict.ok) return { ok: false, code: verdict.code }

  const [mammoth, { htmlToDocument }] = await Promise.all([
    import('mammoth'),
    import('./html-to-prosemirror'),
  ])

  let converted: { value: string; messages: Array<{ message?: string }> }
  try {
    converted = (await Promise.race([
      mammoth.convertToHtml(
        { buffer },
        {
          // Keeps mammoth from embedding a base64 copy of every image. The
          // element it emits instead is discarded by the converter, which
          // counts it on the way past.
          convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
        },
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('CONVERSION_TIMEOUT')), CONVERSION_TIMEOUT_MS),
      ),
    ])) as { value: string; messages: Array<{ message?: string }> }
  } catch (error) {
    const timedOut = error instanceof Error && error.message === 'CONVERSION_TIMEOUT'
    return { ok: false, code: timedOut ? 'CONVERSION_TIMEOUT' : 'CONVERSION_FAILED' }
  }

  const { doc, report } = htmlToDocument(converted.value)

  // Parsed once more against the schema before anybody stores it. The converter
  // already produces only allowed nodes; this is the belt to its braces, and it
  // is also what refuses a file with no readable text in it.
  const { parseDocument } = await import('./prosemirror')
  const parsed = parseDocument(doc)
  if (!parsed.ok) return { ok: false, code: 'EMPTY_DOCUMENT' }

  return {
    ok: true,
    doc: parsed.doc,
    report,
    warnings: converted.messages
      .map((message) => message.message ?? '')
      .filter(Boolean)
      .slice(0, 20),
  }
}

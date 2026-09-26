import { inflateSync } from 'node:zlib'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  type PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
} from 'pdf-lib'
import { JpegError, stripJpegMetadata } from './jpeg'
import { MAX_COMPANION_BYTES } from './validation'

/**
 * Preparing an author's typeset PDF to be offered next to their article.
 *
 * **Server only.** Parses untrusted bytes with `pdf-lib`.
 *
 * The rest of the platform rebuilds what it is given (D18): a Word file becomes
 * our own document tree and nothing of the original survives. A companion PDF
 * cannot be treated that way — its typesetting *is* the reason it exists, and a
 * PDF we regenerated would be worse than the one the author made with
 * `pdflatex` (D24). So this is the one place the platform keeps a file it did
 * not write, and the policy is narrow on purpose, in two halves:
 *
 * **Refuse whatever can act.** JavaScript, launch and submit actions, links to
 * other files, embedded files, forms and rich media. A download is opened in
 * whatever viewer the reader has, some of which honour all of those; the answer
 * to "is this safe to run" for a document from a political author, downloaded by
 * readers the movement's adversaries would like to reach, is not to find out.
 * Comments and other markup annotations are refused too, for a different
 * reason — a PDF that went round the circle for review can carry the reviewers'
 * notes and their names, which were never meant to be published.
 *
 * **Strip whatever identifies, and say so.** The document information dictionary
 * and every XMP packet (author name, the producing software, the machine it ran
 * on), Acrobat's private `PieceInfo`, pdfTeX's `PTEX.*` keys (the absolute path
 * of every included figure — `/home/<username>/…` — and each figure's own
 * information dictionary), the EXIF in embedded photographs (see `jpeg.ts`),
 * and every object nothing references any more, which is where earlier versions
 * of an incrementally saved file live. None of that is visible on the page, and
 * for an author whose safety depends on what can be tied to them, invisible is
 * the problem. The author is told what was removed, the way the importer reports
 * what it dropped.
 *
 * What is **not** attempted: text drawn in white, content under a picture, or
 * hidden layers. Those are what the author put on the page, and the answer to
 * them is the author reading their own file.
 */

export type PdfError =
  | 'MISSING_FILE'
  | 'FILE_TOO_LARGE'
  | 'NOT_A_PDF'
  | 'ENCRYPTED'
  | 'UNREADABLE'
  | 'EMPTY_DOCUMENT'
  | 'ACTIVE_CONTENT'
  | 'ANNOTATIONS'
  | 'UNSUPPORTED_IMAGE'

/** What was taken out, for the author's report. Counts, never content. */
export type PdfCleaning = {
  /** The information dictionary, XMP, PieceInfo or pdfTeX paths were present. */
  properties: boolean
  /** Embedded photographs that carried camera or location data. */
  photos: number
  /** Unreferenced objects removed — earlier versions of an edited file. */
  leftovers: number
}

export type PreparedPdf = {
  bytes: Uint8Array
  pageCount: number
  cleaning: PdfCleaning
}

export type PdfResult = { ok: true; value: PreparedPdf } | { ok: false; code: PdfError }

/** `%PDF-` — the only thing that actually makes a file a PDF. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]

/**
 * Actions that do something other than move within this document or open a web
 * page. `Hide`, `Named`, `SetOCGState` and `Trans` stay: they change what the
 * viewer shows and nothing else.
 */
const REFUSED_ACTIONS = new Set([
  'JavaScript',
  'Launch',
  'SubmitForm',
  'ResetForm',
  'ImportData',
  'GoToR',
  'GoToE',
  'Rendition',
  'Sound',
  'Movie',
  'RichMediaExecute',
])

/** Keys whose mere presence means embedded code, files or forms. */
const REFUSED_KEYS = [
  'JS',
  'JavaScript',
  'EmbeddedFiles',
  'EF',
  'XFA',
  'RichMediaContent',
]

/** Keys that describe who made the file and how, and nothing on the page. */
const IDENTIFYING_KEYS = ['Metadata', 'PieceInfo']

const SAFE_URI = /^(https?:|mailto:)/i

class Refusal extends Error {
  constructor(readonly code: PdfError) {
    super(code)
  }
}

const name = (value: string) => PDFName.of(value)

function nameValue(object: PDFObject | undefined): string | null {
  return object instanceof PDFName ? object.decodeText() : null
}

function textValue(object: PDFObject | undefined): string | null {
  if (object instanceof PDFString || object instanceof PDFHexString) {
    return object.decodeText()
  }
  return null
}

/** Every dictionary in an object, including those nested directly inside it. */
function* dictionaries(object: PDFObject): Generator<PDFDict> {
  const pending: Array<PDFObject> = [object]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current instanceof PDFStream) {
      pending.push(current.dict)
    } else if (current instanceof PDFDict) {
      yield current
      for (const [, value] of current.entries()) pending.push(value)
    } else if (current instanceof PDFArray) {
      pending.push(...current.asArray())
    }
  }
}

function refuseActiveContent(dict: PDFDict): void {
  for (const key of REFUSED_KEYS) {
    if (dict.has(name(key))) throw new Refusal('ACTIVE_CONTENT')
  }
  if (nameValue(dict.get(name('Type'))) === 'EmbeddedFile') {
    throw new Refusal('ACTIVE_CONTENT')
  }
  const action = nameValue(dict.get(name('S')))
  if (action && REFUSED_ACTIONS.has(action)) throw new Refusal('ACTIVE_CONTENT')
  if (action === 'URI') {
    const uri = textValue(dict.get(name('URI')))
    if (!uri || !SAFE_URI.test(uri.trim())) throw new Refusal('ACTIVE_CONTENT')
  }
}

/** Remove the identifying keys from one dictionary. True when anything went. */
function stripIdentifying(dict: PDFDict): boolean {
  let removed = false
  for (const key of dict.keys()) {
    const text = key.decodeText()
    if (IDENTIFYING_KEYS.includes(text) || text.startsWith('PTEX.')) {
      dict.delete(key)
      removed = true
    }
  }
  return removed
}

/**
 * Delete every indirect object the document no longer reaches.
 *
 * An incrementally saved PDF appends each edit and leaves the superseded objects
 * in the file — an earlier paragraph, an earlier author name. `pdf-lib` loads
 * and writes every object it finds, referenced or not, so without this a
 * "cleaned" file would still carry its own history.
 */
function collectGarbage(doc: PDFDocument): number {
  const { context } = doc
  const reachable = new Set<string>()
  const pending: Array<PDFObject> = []
  if (context.trailerInfo.Root) pending.push(context.trailerInfo.Root)
  if (context.trailerInfo.Info) pending.push(context.trailerInfo.Info)

  while (pending.length > 0) {
    const current = pending.pop()
    if (current instanceof PDFRef) {
      if (reachable.has(current.tag)) continue
      reachable.add(current.tag)
      const target = context.lookup(current)
      if (target) pending.push(target)
    } else if (current instanceof PDFStream) {
      pending.push(current.dict)
    } else if (current instanceof PDFDict) {
      for (const [, value] of current.entries()) pending.push(value)
    } else if (current instanceof PDFArray) {
      pending.push(...current.asArray())
    }
  }

  let removed = 0
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (reachable.has(ref.tag)) continue
    context.delete(ref)
    // Object and cross-reference streams are containers the parser has already
    // unpacked, not content anybody wrote; the writer builds its own.
    const type =
      object instanceof PDFStream ? nameValue(object.dict.get(name('Type'))) : null
    if (type !== 'ObjStm' && type !== 'XRef') removed += 1
  }
  return removed
}

function filters(dict: PDFDict): Array<string> {
  const filter = dict.get(name('Filter'))
  if (filter instanceof PDFName) return [filter.decodeText()]
  if (filter instanceof PDFArray) {
    return filter.asArray().map((entry) => nameValue(entry) ?? '?')
  }
  return []
}

/**
 * Strip one image stream's JPEG metadata, if it is a JPEG. Returns the stream
 * to store in its place and whether it carried anything, or null when it needs
 * no change.
 */
function cleanImage(
  stream: PDFRawStream,
): { stream: PDFRawStream; hadMetadata: boolean } | null {
  const dict = stream.dict
  if (nameValue(dict.get(name('Subtype'))) !== 'Image') return null
  const chain = filters(dict)
  if (!chain.includes('DCTDecode')) return null

  let jpeg: Uint8Array
  if (chain.length === 1) {
    jpeg = stream.contents
  } else if (
    chain.length === 2 &&
    chain[0] === 'FlateDecode' &&
    chain[1] === 'DCTDecode'
  ) {
    try {
      jpeg = inflateSync(stream.contents, { maxOutputLength: MAX_COMPANION_BYTES * 4 })
    } catch {
      throw new Refusal('UNSUPPORTED_IMAGE')
    }
  } else {
    // A JPEG behind some other encoding. Uncommon enough that refusing is
    // cheaper than being wrong about what is inside it.
    throw new Refusal('UNSUPPORTED_IMAGE')
  }

  let stripped: ReturnType<typeof stripJpegMetadata>
  try {
    stripped = stripJpegMetadata(jpeg)
  } catch (err) {
    if (err instanceof JpegError) throw new Refusal('UNSUPPORTED_IMAGE')
    throw err
  }
  if (stripped.removed === 0 && chain.length === 1) return null

  const cleaned = dict.clone()
  cleaned.set(name('Filter'), name('DCTDecode'))
  const parms = dict.get(name('DecodeParms'))
  if (parms instanceof PDFArray) {
    const dctParms = parms.get(1)
    if (dctParms instanceof PDFDict) cleaned.set(name('DecodeParms'), dctParms)
    else cleaned.delete(name('DecodeParms'))
  }
  return {
    stream: PDFRawStream.of(cleaned, stripped.bytes),
    hadMetadata: stripped.removed > 0,
  }
}

/**
 * Check, clean and re-save a companion PDF.
 *
 * `title` becomes the only entry of the new information dictionary, so a reader's
 * viewer shows the article's name rather than whatever the author's LaTeX left.
 */
export async function preparePdf(
  file: File | null | undefined,
  title: string,
): Promise<PdfResult> {
  if (!file || typeof file.arrayBuffer !== 'function' || file.size === 0) {
    return { ok: false, code: 'MISSING_FILE' }
  }
  // Checked before the body is read, and again after: `size` comes from the
  // client, the byte count does not.
  if (file.size > MAX_COMPANION_BYTES) return { ok: false, code: 'FILE_TOO_LARGE' }
  const input = new Uint8Array(await file.arrayBuffer())
  if (input.byteLength > MAX_COMPANION_BYTES) return { ok: false, code: 'FILE_TOO_LARGE' }
  if (!PDF_MAGIC.every((byte, i) => input[i] === byte)) {
    return { ok: false, code: 'NOT_A_PDF' }
  }

  let doc: PDFDocument
  try {
    /**
     * `updateMetadata: false`, or pdf-lib stamps its own producer and dates in.
     *
     * `ignoreEncryption: true` so that encryption is detected by reading a flag
     * rather than by catching `EncryptedPDFError`: pdf-lib is compiled to ES5,
     * where a subclass of `Error` does not survive `instanceof`, so the check
     * silently never matched and an encrypted file came back as "unreadable".
     * A password-protected file is refused either way — we cannot inspect what
     * we cannot read — but the author deserves to be told the actual reason.
     */
    doc = await PDFDocument.load(input, { updateMetadata: false, ignoreEncryption: true })
  } catch {
    return { ok: false, code: 'UNREADABLE' }
  }
  if (doc.isEncrypted) return { ok: false, code: 'ENCRYPTED' }

  try {
    const cleaning: PdfCleaning = { properties: false, photos: 0, leftovers: 0 }
    const { context } = doc

    // Leftovers first, while the information dictionary is still reachable —
    // otherwise it would be counted as history rather than as properties.
    cleaning.leftovers = collectGarbage(doc)
    if (context.trailerInfo.Info) {
      cleaning.properties = true
      context.trailerInfo.Info = undefined
    }

    if (doc.catalog.has(name('AcroForm'))) throw new Refusal('ACTIVE_CONTENT')

    const pageCount = doc.getPageCount()
    if (pageCount === 0) return { ok: false, code: 'EMPTY_DOCUMENT' }

    // Links are the one annotation a typeset proposal needs — its contents
    // page, its cross-references, its sources. Everything else is somebody's
    // note on the text, or an interactive widget.
    for (const page of doc.getPages()) {
      const annots = page.node.Annots()
      if (!annots) continue
      for (const entry of annots.asArray()) {
        const annot = entry instanceof PDFRef ? context.lookup(entry) : entry
        if (!(annot instanceof PDFDict)) continue
        if (nameValue(annot.get(name('Subtype'))) !== 'Link') {
          throw new Refusal('ANNOTATIONS')
        }
      }
    }

    for (const [ref, object] of context.enumerateIndirectObjects()) {
      for (const dict of dictionaries(object)) {
        refuseActiveContent(dict)
        if (stripIdentifying(dict)) cleaning.properties = true
      }
      if (object instanceof PDFRawStream) {
        const cleaned = cleanImage(object)
        if (cleaned) {
          context.assign(ref, cleaned.stream)
          if (cleaned.hadMetadata) cleaning.photos += 1
        }
      }
    }

    // The XMP streams just unlinked are now unreachable; take them out too.
    collectGarbage(doc)
    doc.setTitle(title)

    const bytes = await doc.save({ addDefaultPage: false, updateFieldAppearances: false })
    return { ok: true, value: { bytes, pageCount, cleaning } }
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, code: err.code }
    return { ok: false, code: 'UNREADABLE' }
  }
}

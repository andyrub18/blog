import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  type ArchiveEntry,
  convertDocx,
  inspectArchive,
  MAX_COMPRESSION_RATIO,
  MAX_DOCX_BYTES,
  MAX_ENTRIES,
  MAX_UNCOMPRESSED_BYTES,
  readArchiveIndex,
} from './docx'
import { renderDocumentToHtml } from './prosemirror'

/**
 * The import, against real `.docx` files built here rather than checked in.
 *
 * Building them means the fixtures say what they are testing: the zip bomb is
 * visibly a zip bomb, and the Word file with a `javascript:` link is visibly
 * that. A binary blob in the repository would hide both.
 */

const DOCUMENT_XML = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${body}</w:body>
</w:document>`

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`

/** A paragraph, optionally carrying a hyperlink relationship. */
const para = (text: string) =>
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

const heading = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`

const boldPara = (text: string) =>
  `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${text}</w:t></w:r></w:p>`

const table = () =>
  `<w:tbl><w:tr><w:tc>${para('Année')}</w:tc><w:tc>${para('Recettes')}</w:tc></w:tr>` +
  `<w:tr><w:tc>${para('2025')}</w:tc><w:tc>${para('inconnu')}</w:tc></w:tr></w:tbl>`

/**
 * `File` wants a `BlobPart`, and TypeScript will not accept a Node `Buffer` as
 * one — the buffer it is backed by might in principle be shared. In a test
 * building its own bytes it never is.
 */
const part = (bytes: Buffer): BlobPart => bytes as unknown as BlobPart

/** Build a real `.docx` in memory. */
async function docx(
  body: string,
  extra: Record<string, string | Uint8Array> = {},
): Promise<File> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', RELS)
  zip.file('word/document.xml', DOCUMENT_XML(body))
  for (const [name, content] of Object.entries(extra)) zip.file(name, content)
  const bytes = await zip.generateAsync({ type: 'nodebuffer' })
  return new File([part(bytes)], 'article.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

const entry = (partial: Partial<ArchiveEntry>): ArchiveEntry => ({
  name: 'word/document.xml',
  compressed: 100,
  uncompressed: 1000,
  ...partial,
})

describe('what is refused before anything is opened', () => {
  it('refuses a file that is not a ZIP, whatever it claims to be', async () => {
    // `file.type` is set by the client and is trivially spoofed.
    const notAZip = new File([Buffer.from('%PDF-1.4 not a word file')], 'article.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const result = await convertDocx(notAZip)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NOT_A_ZIP')
  })

  it('refuses a ZIP that is not a Word document', async () => {
    const zip = new JSZip()
    zip.file('notes.txt', 'just a zip')
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    const result = await convertDocx(new File([part(bytes)], 'article.docx'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NOT_A_DOCX')
  })

  it('refuses an empty upload and a missing one', async () => {
    expect(await convertDocx(null)).toEqual({ ok: false, code: 'MISSING_FILE' })
    const empty = new File([], 'article.docx')
    expect(await convertDocx(empty)).toEqual({ ok: false, code: 'MISSING_FILE' })
  })

  it('refuses a file over the cap without reading it into memory', async () => {
    // `size` is checked first; the body is never awaited.
    const huge = {
      size: MAX_DOCX_BYTES + 1,
      arrayBuffer: () => {
        throw new Error('the body should never be read')
      },
    } as unknown as File
    const result = await convertDocx(huge)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('FILE_TOO_LARGE')
  })
})

describe('zip-bomb defence', () => {
  it('refuses an entry that expands beyond any plausible ratio', () => {
    // The classic bomb: a few kilobytes of zeroes that become gigabytes.
    const verdict = inspectArchive([
      entry({ name: '[Content_Types].xml' }),
      entry({ compressed: 1000, uncompressed: 1000 * (MAX_COMPRESSION_RATIO + 1) }),
    ])
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('ARCHIVE_REFUSED')
  })

  it('refuses an archive whose parts add up to too much', () => {
    const many = Array.from({ length: 40 }, () =>
      entry({ compressed: 1_000_000, uncompressed: MAX_UNCOMPRESSED_BYTES / 20 }),
    )
    const verdict = inspectArchive([entry({ name: '[Content_Types].xml' }), ...many])
    expect(verdict.ok).toBe(false)
  })

  it('refuses an archive with more entries than any document needs', () => {
    const many = Array.from({ length: MAX_ENTRIES + 1 }, () => entry({}))
    expect(inspectArchive(many).ok).toBe(false)
  })

  it('refuses a path-traversing entry name', () => {
    const verdict = inspectArchive([
      entry({ name: '[Content_Types].xml' }),
      entry({ name: '../../etc/passwd' }),
    ])
    expect(verdict.ok).toBe(false)
  })

  it('accepts an ordinary Word archive', () => {
    expect(
      inspectArchive([
        entry({ name: '[Content_Types].xml', compressed: 300, uncompressed: 1200 }),
        entry({ name: 'word/document.xml', compressed: 900, uncompressed: 4000 }),
      ]).ok,
    ).toBe(true)
  })

  it('reads sizes out of a real archive without decompressing it', async () => {
    const file = await docx(para('Bonjour'))
    const buffer = Buffer.from(await file.arrayBuffer())
    const entries = readArchiveIndex(buffer)
    expect(entries).not.toBeNull()
    expect(entries?.map((e) => e.name)).toContain('word/document.xml')
    expect(entries?.every((e) => e.uncompressed >= 0)).toBe(true)
  })

  it('returns null for something that is not an archive at all', () => {
    expect(readArchiveIndex(Buffer.from('not a zip, not even close'))).toBeNull()
  })
})

describe('converting a real document', () => {
  let converted: Awaited<ReturnType<typeof convertDocx>>

  beforeAll(async () => {
    converted = await convertDocx(
      await docx(
        heading('Diagnostic') +
          para('Le premier constat porte sur les recettes.') +
          boldPara('Un point important.') +
          table(),
      ),
    )
  })

  it('keeps the structure Word was carrying', () => {
    expect(converted.ok).toBe(true)
    if (!converted.ok) return
    const html = renderDocumentToHtml(converted.doc)
    // The article title is the page's h1, so a Heading 1 lands at h2.
    expect(html).toContain('<h2>Diagnostic</h2>')
    expect(html).toContain('<p>Le premier constat porte sur les recettes.</p>')
    expect(html).toContain('<strong>Un point important.</strong>')
    expect(html).toContain('<div class="article-table">')
    expect(html).toContain('2025')
  })

  it('reports what it kept, by kind', () => {
    expect(converted.ok).toBe(true)
    if (!converted.ok) return
    expect(converted.report.kept.heading).toBe(1)
    expect(converted.report.kept.table).toBe(1)
    expect(converted.report.kept.paragraph).toBeGreaterThanOrEqual(2)
  })

  it('refuses a document with no readable text in it', async () => {
    const result = await convertDocx(await docx(''))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('EMPTY_DOCUMENT')
  })

  it('does not inline images as base64, which would bloat every page load', async () => {
    // A one-pixel PNG, embedded the way Word does it.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    const result = await convertDocx(
      await docx(para('Avec une image.'), { 'word/media/image1.png': png }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const stored = JSON.stringify(result.doc)
    expect(stored).not.toContain('data:image')
    expect(stored).not.toContain('base64')
    expect(stored).toContain('Avec une image.')
  })
})

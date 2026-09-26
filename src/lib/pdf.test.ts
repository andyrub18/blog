// @vitest-environment node
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { preparePdf } from './pdf'
import { MAX_COMPANION_BYTES } from './validation'

/**
 * The rules a companion PDF is held to, tested on real files.
 *
 * Each fixture is built with pdf-lib and then fed back through `preparePdf`, so
 * what is asserted is what a reader would download — not what a mock agreed to.
 * The secrets planted in them are strings that must not appear anywhere in the
 * output bytes; a search of the raw file is exactly the attack, so it is also
 * the test.
 */

const TITLE = 'Réforme de l’administration publique'

type Build = (doc: PDFDocument) => void | Promise<void>

async function pdf(build?: Build): Promise<File> {
  const doc = await PDFDocument.create()
  doc.addPage([300, 300])
  await build?.(doc)
  // Uncompressed objects, so a planted string is findable in the input too and
  // its absence from the output means something.
  const bytes = await doc.save({ useObjectStreams: false })
  return new File([new Uint8Array(bytes)], 'proposal.pdf', { type: 'application/pdf' })
}

async function prepare(file: File | null) {
  return preparePdf(file, TITLE)
}

async function prepared(file: File) {
  const result = await prepare(file)
  if (!result.ok) throw new Error(`refused: ${result.code}`)
  return result.value
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')

/**
 * The output, with every object written out in the clear.
 *
 * `preparePdf` saves with object streams, which are compressed, so searching
 * its raw bytes for a planted secret would pass whether or not the secret was
 * still there. Reloading and re-saving uncompressed keeps every object the file
 * holds — pdf-lib writes unreferenced ones too — so an absence here is real.
 */
async function searchable(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  return latin1(await doc.save({ useObjectStreams: false }))
}

/**
 * Plant a document information dictionary written as plain literal strings.
 * pdf-lib's own setters write UTF-16 hex, which a search for the text would
 * never find in the input either — and a test that cannot see its own secret
 * going in proves nothing by not seeing it come out.
 */
function plantInfo(doc: PDFDocument, entries: Record<string, string>) {
  const dict = Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [key, PDFString.of(value)]),
  )
  doc.context.trailerInfo.Info = doc.context.register(doc.context.obj(dict))
}

/** A tiny but well-formed JPEG, with an EXIF segment carrying a location. */
function jpegWithExif(): Uint8Array {
  const seg = (marker: number, payload: Array<number>) => {
    const length = payload.length + 2
    return [0xff, marker, length >> 8, length & 0xff, ...payload]
  }
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
  return new Uint8Array([
    0xff,
    0xd8,
    ...seg(0xe0, ascii('JFIF\0')),
    ...seg(0xe1, ascii('Exif\0\0GPS-SECRET 18.5392N')),
    ...seg(0xc0, [8, 0, 1, 0, 1, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
    ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    0x00,
    0x00,
    0xff,
    0xd9,
  ])
}

describe('preparePdf — what it accepts', () => {
  it('accepts an ordinary document and reports its pages', async () => {
    const value = await prepared(
      await pdf((doc) => {
        doc.addPage([300, 300])
      }),
    )
    expect(value.pageCount).toBe(2)
    const reloaded = await PDFDocument.load(value.bytes)
    expect(reloaded.getPageCount()).toBe(2)
  })

  it('names the file after the article, and nothing else', async () => {
    const value = await prepared(await pdf())
    const reloaded = await PDFDocument.load(value.bytes, { updateMetadata: false })
    expect(reloaded.getTitle()).toBe(TITLE)
    expect(reloaded.getAuthor()).toBeUndefined()
    expect(reloaded.getProducer()).toBeUndefined()
    expect(reloaded.getCreator()).toBeUndefined()
  })

  /** Hyperref's output: a contents page and a bibliography are all links. */
  it('keeps links to web pages and mail addresses', async () => {
    const file = await pdf((doc) => {
      const page = doc.getPage(0)
      for (const uri of [
        'https://kleayiti.com',
        'http://example.org/source',
        'mailto:a@b.ht',
      ]) {
        const link = doc.context.register(
          doc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [0, 0, 10, 10],
            A: { S: 'URI', URI: PDFString.of(uri) },
          }),
        )
        page.node.addAnnot(link)
      }
    })
    const value = await prepared(file)
    expect(await searchable(value.bytes)).toContain('https://kleayiti.com')
  })
})

describe('preparePdf — what it removes', () => {
  it('drops the author, the software and the dates', async () => {
    const file = await pdf((doc) => {
      plantInfo(doc, {
        Author: 'Jean-SECRET Baptiste',
        Creator: 'LaTeX with hyperref on /home/jeansecret',
        Producer: 'pdfTeX-1.40.25',
        Keywords: 'brouillon interne',
      })
    })
    expect(latin1(new Uint8Array(await file.arrayBuffer()))).toContain('SECRET')

    const value = await prepared(file)
    expect(value.cleaning.properties).toBe(true)
    expect(await searchable(value.bytes)).not.toMatch(
      /SECRET|jeansecret|pdfTeX|brouillon/,
    )
  })

  it('drops XMP packets, wherever they hang', async () => {
    const file = await pdf((doc) => {
      const xmp = doc.context.stream('<dc:creator>XMP-SECRET</dc:creator>', {
        Type: 'Metadata',
        Subtype: 'XML',
      })
      doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp))
      doc.getPage(0).node.set(PDFName.of('Metadata'), doc.context.register(xmp.clone()))
    })
    const value = await prepared(file)
    expect(value.cleaning.properties).toBe(true)
    expect(await searchable(value.bytes)).not.toContain('XMP-SECRET')
  })

  /**
   * pdfTeX records the path of every included figure, and the figure's own
   * information dictionary. On a laptop that path starts with the author's
   * username.
   */
  it('drops pdfTeX’s record of where the figures came from', async () => {
    const file = await pdf((doc) => {
      const figure = doc.context.stream('q Q', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 1, 1],
        'PTEX.FileName': PDFString.of('/home/jeansecret/klea/figures/budget.pdf'),
        'PTEX.PageNumber': 1,
        'PTEX.InfoDict': { Author: PDFString.of('Figure-SECRET') },
      })
      const ref = doc.context.register(figure)
      doc.getPage(0).node.setXObject(PDFName.of('Fig1'), ref)
    })
    const value = await prepared(file)
    expect(await searchable(value.bytes)).not.toMatch(/jeansecret|Figure-SECRET|PTEX/)
  })

  it('drops the location from an embedded photograph', async () => {
    const file = await pdf(async (doc) => {
      const image = await doc.embedJpg(jpegWithExif())
      doc.getPage(0).drawImage(image, { x: 0, y: 0, width: 10, height: 10 })
    })
    expect(latin1(new Uint8Array(await file.arrayBuffer()))).toContain('GPS-SECRET')

    const value = await prepared(file)
    expect(value.cleaning.photos).toBe(1)
    const output = await searchable(value.bytes)
    expect(output).not.toContain('GPS-SECRET')
    // Still a picture: the frame header survived.
    expect(output).toContain('JFIF')
  })

  /**
   * An incrementally saved file keeps what each edit replaced. Here an object
   * nothing points at stands in for the paragraph an author deleted.
   */
  it('drops objects nothing refers to any more', async () => {
    const file = await pdf((doc) => {
      doc.context.register(
        doc.context.obj({ Draft: PDFString.of('earlier-draft-SECRET') }),
      )
    })
    const value = await prepared(file)
    expect(value.cleaning.leftovers).toBeGreaterThanOrEqual(1)
    expect(await searchable(value.bytes)).not.toContain('earlier-draft-SECRET')
  })

  it('reports nothing removed from a file with nothing to remove', async () => {
    const first = await prepared(await pdf())
    const second = await prepared(new File([new Uint8Array(first.bytes)], 'again.pdf'))
    expect(second.cleaning).toEqual({ properties: true, photos: 0, leftovers: 0 })
  })
})

describe('preparePdf — what it refuses', () => {
  it.each([
    [
      'JavaScript run on open',
      { OpenAction: { S: 'JavaScript', JS: PDFString.of('app.alert(1)') } },
    ],
    ['a launch action', { OpenAction: { S: 'Launch', F: PDFString.of('cmd.exe') } }],
    [
      'a link into another file',
      { OpenAction: { S: 'GoToR', F: PDFString.of('x.pdf'), D: [0, 'Fit'] } },
    ],
    ['a form', { AcroForm: { Fields: [] } }],
    ['embedded files', { Names: { EmbeddedFiles: { Names: [] } } }],
    ['a document-level script', { Names: { JavaScript: { Names: [] } } }],
  ])('refuses %s', async (_, catalogEntries) => {
    const file = await pdf((doc) => {
      for (const [key, value] of Object.entries(catalogEntries)) {
        doc.catalog.set(PDFName.of(key), doc.context.obj(value as never))
      }
    })
    expect(await prepare(file)).toEqual({ ok: false, code: 'ACTIVE_CONTENT' })
  })

  it('refuses a link whose address is not a web page or a mail address', async () => {
    const file = await pdf((doc) => {
      const link = doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [0, 0, 10, 10],
          A: { S: 'URI', URI: PDFString.of('javascript:alert(1)') },
        }),
      )
      doc.getPage(0).node.addAnnot(link)
    })
    expect(await prepare(file)).toEqual({ ok: false, code: 'ACTIVE_CONTENT' })
  })

  /** A reviewer's note, with the reviewer's name in `/T`, is not the author's to publish. */
  it('refuses comments', async () => {
    const file = await pdf((doc) => {
      const note = doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Text',
          Rect: [0, 0, 10, 10],
          T: PDFString.of('A reviewer'),
          Contents: PDFString.of('This section is weak.'),
        }),
      )
      doc.getPage(0).node.addAnnot(note)
    })
    expect(await prepare(file)).toEqual({ ok: false, code: 'ANNOTATIONS' })
  })

  it('refuses a password-protected file, which it cannot inspect', async () => {
    const file = await pdf((doc) => {
      doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: 'Standard', V: 2 })
    })
    expect(await prepare(file)).toEqual({ ok: false, code: 'ENCRYPTED' })
  })

  it('refuses what is not a PDF, whatever it is called', async () => {
    const zip = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])], 'x.pdf', {
      type: 'application/pdf',
    })
    expect(await prepare(zip)).toEqual({ ok: false, code: 'NOT_A_PDF' })
  })

  it('refuses a file over the ceiling', async () => {
    const big = new File([new Uint8Array(MAX_COMPANION_BYTES + 1)], 'x.pdf')
    expect(await prepare(big)).toEqual({ ok: false, code: 'FILE_TOO_LARGE' })
  })

  it('refuses nothing at all', async () => {
    expect(await prepare(null)).toEqual({ ok: false, code: 'MISSING_FILE' })
  })

  it('refuses a file that only starts like a PDF', async () => {
    const fake = new File([new TextEncoder().encode('%PDF-1.7\nnot really')], 'x.pdf')
    const result = await prepare(fake)
    expect(result.ok).toBe(false)
  })
})

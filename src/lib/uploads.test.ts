import { describe, expect, it } from 'vitest'
import { stageApplicationPdf, UploadError } from './uploads'
import { MAX_PDF_BYTES } from './validation'

/** Build a File whose reported MIME type is independent of its real bytes. */
function makeFile(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes as BlobPart], name, { type })
}

const PDF_HEADER = new TextEncoder().encode('%PDF-1.7\n')

function pdfOfSize(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(PDF_HEADER.subarray(0, Math.min(PDF_HEADER.length, size)))
  return bytes
}

describe('stageApplicationPdf', () => {
  it('accepts a real PDF', async () => {
    const staged = await stageApplicationPdf(
      'cv',
      makeFile(pdfOfSize(2048), 'cv.pdf', 'application/pdf'),
    )
    expect(staged.field).toBe('cv')
    expect(staged.bytes.byteLength).toBe(2048)
  })

  it('rejects a file that only CLAIMS to be a PDF', async () => {
    // The whole point: `file.type` is attacker-controlled. A ZIP renamed to
    // .pdf and labelled application/pdf must not get through.
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])
    await expect(
      stageApplicationPdf('cv', makeFile(zip, 'cv.pdf', 'application/pdf')),
    ).rejects.toMatchObject({ code: 'INVALID_TYPE' })
  })

  it('rejects an HTML payload disguised as a PDF', async () => {
    const html = new TextEncoder().encode('<script>alert(1)</script>')
    await expect(
      stageApplicationPdf('vision', makeFile(html, 'x.pdf', 'application/pdf')),
    ).rejects.toBeInstanceOf(UploadError)
  })

  it('accepts a genuine PDF even when the browser mislabels it', async () => {
    const staged = await stageApplicationPdf(
      'vision',
      makeFile(pdfOfSize(512), 'essay.pdf', 'application/octet-stream'),
    )
    expect(staged.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it.each([undefined, null])('rejects a missing file (%s)', async (value) => {
    await expect(stageApplicationPdf('cv', value)).rejects.toMatchObject({
      code: 'MISSING_FILE',
    })
  })

  it('rejects an empty file', async () => {
    await expect(
      stageApplicationPdf(
        'cv',
        makeFile(new Uint8Array(0), 'empty.pdf', 'application/pdf'),
      ),
    ).rejects.toMatchObject({ code: 'MISSING_FILE' })
  })

  it('rejects a file over the size cap', async () => {
    await expect(
      stageApplicationPdf(
        'contribution',
        makeFile(pdfOfSize(MAX_PDF_BYTES + 1), 'big.pdf', 'application/pdf'),
      ),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
  })

  it('sanitises a hostile filename', async () => {
    const staged = await stageApplicationPdf(
      'cv',
      makeFile(pdfOfSize(256), '../../etc/passwd;rm -rf.pdf', 'application/pdf'),
    )
    expect(staged.safeName).not.toContain('/')
    expect(staged.safeName).not.toContain('..')
    expect(staged.safeName).toMatch(/^[a-zA-Z0-9._-]+$/)
  })

  it('never writes to disk while staging', async () => {
    // Staging must be pure: nothing is persisted until commitApplicationPdf.
    const staged = await stageApplicationPdf(
      'cv',
      makeFile(pdfOfSize(128), 'a.pdf', 'application/pdf'),
    )
    expect(staged).not.toHaveProperty('path')
  })
})

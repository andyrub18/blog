import { describe, expect, it } from 'vitest'
import { JpegError, stripJpegMetadata } from './jpeg'

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

/** One marker segment: `FF <marker> <length> <payload>`. */
function segment(marker: number, payload: Array<number>): Array<number> {
  const length = payload.length + 2
  return [0xff, marker, length >> 8, length & 0xff, ...payload]
}

const SOI = [0xff, 0xd8]
const EOI = [0xff, 0xd9]
const JFIF = segment(0xe0, ascii('JFIF\0'))
const EXIF = segment(0xe1, ascii('Exif\0\0GPS 18.5392N 72.3350W'))
const XMP = segment(
  0xe1,
  ascii('http://ns.adobe.com/xap/1.0/\0<dc:creator>Jean</dc:creator>'),
)
const ICC = segment(0xe2, ascii('ICC_PROFILE\0\x01\x01sRGB'))
const MPF = segment(0xe2, ascii('MPF\0preview with its own EXIF'))
const IPTC = segment(0xed, ascii('Photoshop 3.0\0byline: Jean'))
const ADOBE = segment(0xee, ascii('Adobe\0\x64\0\0\0\0\x01'))
const COMMENT = segment(0xfe, ascii('taken at the house'))
const SOF = segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0])
// A scan header, then entropy-coded bytes — including an 0xFF 0xE1 pair that is
// picture data, not a segment, and must survive.
const SCAN = [...segment(0xda, [1, 1, 0, 0, 0x3f, 0]), 0x12, 0xff, 0x00, 0xff, 0xe1, 0x34]

const jpeg = (...parts: Array<Array<number>>) =>
  new Uint8Array([...SOI, ...parts.flat(), ...EOI])
const text = (bytes: Uint8Array) => String.fromCharCode(...bytes)

describe('stripJpegMetadata', () => {
  it('removes EXIF, XMP, IPTC and comments', () => {
    const { bytes, removed } = stripJpegMetadata(
      jpeg(JFIF, EXIF, XMP, IPTC, COMMENT, SOF, SCAN),
    )
    expect(removed).toBe(4)
    expect(text(bytes)).not.toMatch(/GPS|creator|byline|house/)
  })

  /**
   * The three segments a decoder needs. Dropping the Adobe one inverts a CMYK
   * image's colours; dropping the ICC profile shifts them.
   */
  it('keeps JFIF, the ICC profile and the Adobe colour transform', () => {
    const input = jpeg(JFIF, ICC, ADOBE, SOF, SCAN)
    const { bytes, removed } = stripJpegMetadata(input)
    expect(removed).toBe(0)
    expect(bytes).toEqual(input)
  })

  it('drops an APP2 that is not an ICC profile, because MPF previews carry EXIF', () => {
    const { bytes, removed } = stripJpegMetadata(jpeg(JFIF, MPF, ICC, SOF, SCAN))
    expect(removed).toBe(1)
    expect(text(bytes)).not.toMatch(/preview/)
    expect(text(bytes)).toMatch(/ICC_PROFILE/)
  })

  it('leaves the picture data after the scan header byte for byte', () => {
    const { bytes } = stripJpegMetadata(jpeg(EXIF, SOF, SCAN))
    expect([...bytes]).toEqual([...SOI, ...SOF, ...SCAN, ...EOI])
  })

  it('is idempotent', () => {
    const once = stripJpegMetadata(jpeg(JFIF, EXIF, SOF, SCAN)).bytes
    const twice = stripJpegMetadata(once)
    expect(twice.removed).toBe(0)
    expect(twice.bytes).toEqual(once)
  })

  /** A JPEG we cannot walk is one we cannot vouch for. */
  it.each([
    ['not a JPEG', new Uint8Array(ascii('%PDF-1.7'))],
    ['a truncated segment', new Uint8Array([...SOI, 0xff, 0xe1, 0x00, 0x40, 1, 2])],
    ['a length below two', new Uint8Array([...SOI, 0xff, 0xe1, 0x00, 0x01])],
    ['no image data at all', new Uint8Array([...SOI, ...JFIF])],
  ])('refuses %s', (_, input) => {
    expect(() => stripJpegMetadata(input)).toThrow(JpegError)
  })
})

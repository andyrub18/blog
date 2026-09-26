/**
 * Remove the identifying segments from a JPEG, leaving the picture alone.
 *
 * Why a PDF needs this: `pdflatex` (and most other producers) embed a JPEG by
 * copying the file's bytes verbatim into a `/DCTDecode` stream. A photo taken on
 * a phone therefore carries its EXIF into the published PDF — camera, owner
 * name on some devices, and GPS coordinates of where it was taken, which for a
 * picture of a meeting or of somebody's desk can be a home address. None of
 * that is visible on the page, so no author reviewing their own PDF would ever
 * notice it.
 *
 * What is kept is what decoding needs:
 *
 * - `APP0` — JFIF, the pixel density and colour-space hint.
 * - `APP2` **only** when it is an ICC profile. `APP2` is also where MPF stores
 *   extra images, and those previews carry their own EXIF.
 * - `APP14` — Adobe's colour-transform flag. Dropping it turns a CMYK image's
 *   colours inside out.
 *
 * Everything else in `APP1`–`APP15` (EXIF, XMP, Photoshop/IPTC, maker data) and
 * every `COM` comment is dropped. Segments after the first start-of-scan are
 * copied untouched: that is entropy-coded picture data, and metadata between
 * scans is outside the standard.
 *
 * Pure: bytes in, bytes out, no IO. Throws `JpegError` on anything malformed,
 * because a JPEG we cannot walk is a JPEG we cannot vouch for.
 */

export class JpegError extends Error {}

const SOI = 0xd8
const SOS = 0xda
const EOI = 0xd9
const COM = 0xfe
const APP0 = 0xe0
const APP2 = 0xe2
const APP14 = 0xee

const ICC_TAG = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00] // "ICC_PROFILE\0"

export type JpegStripResult = {
  bytes: Uint8Array
  /** How many segments were dropped. Zero means the input came back unchanged. */
  removed: number
}

function isIccProfile(
  bytes: Uint8Array,
  payloadStart: number,
  payloadEnd: number,
): boolean {
  if (payloadEnd - payloadStart < ICC_TAG.length) return false
  return ICC_TAG.every((byte, i) => bytes[payloadStart + i] === byte)
}

function keep(
  marker: number,
  bytes: Uint8Array,
  payloadStart: number,
  payloadEnd: number,
) {
  if (marker === COM) return false
  if (marker >= APP0 && marker <= 0xef) {
    if (marker === APP0 || marker === APP14) return true
    if (marker === APP2) return isIccProfile(bytes, payloadStart, payloadEnd)
    return false
  }
  return true
}

export function stripJpegMetadata(input: Uint8Array): JpegStripResult {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== SOI) {
    throw new JpegError('not a JPEG')
  }

  const out: Array<Uint8Array> = [input.subarray(0, 2)]
  let removed = 0
  let offset = 2

  while (offset < input.length) {
    if (input[offset] !== 0xff) throw new JpegError('expected a marker')
    // Any number of 0xFF fill bytes may precede a marker.
    let markerAt = offset
    while (markerAt < input.length && input[markerAt] === 0xff) markerAt += 1
    if (markerAt >= input.length) throw new JpegError('truncated marker')
    const marker = input[markerAt]
    const segmentStart = markerAt - 1

    if (marker === EOI) {
      out.push(input.subarray(segmentStart))
      return { bytes: concat(out), removed }
    }

    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(input.subarray(segmentStart, markerAt + 1))
      offset = markerAt + 1
      continue
    }

    if (markerAt + 2 >= input.length) throw new JpegError('truncated length')
    const length = (input[markerAt + 1] << 8) | input[markerAt + 2]
    if (length < 2) throw new JpegError('invalid segment length')
    const payloadStart = markerAt + 3
    const segmentEnd = markerAt + 1 + length
    if (segmentEnd > input.length) throw new JpegError('segment overruns the file')

    if (marker === SOS) {
      // The scan and everything after it is picture data.
      out.push(input.subarray(segmentStart))
      return { bytes: concat(out), removed }
    }

    if (keep(marker, input, payloadStart, segmentEnd)) {
      out.push(input.subarray(segmentStart, segmentEnd))
    } else {
      removed += 1
    }
    offset = segmentEnd
  }

  throw new JpegError('no image data')
}

function concat(parts: Array<Uint8Array>): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    result.set(part, at)
    at += part.length
  }
  return result
}

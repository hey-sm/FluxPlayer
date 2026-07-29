import { describe, expect, it } from 'vitest'
import {
  FONT_KEYS,
  extractTtcFace,
  handleFontRequest,
  isFontKey,
  resolveFontRequestKey,
  resolveFontResponseOrigin,
} from '../../src/main/protocols/fonts'

const SFNT_TRUE_TYPE = 0x00010000
const HEAD_TAG = 0x68656164
const GLYF_TAG = 0x676c7966

/** Build a minimal two-face TTC whose faces share the `glyf` table. */
function buildCollection(): Uint8Array {
  const headData = new Uint8Array(54)
  new DataView(headData.buffer).setUint32(0, 0x00010000)
  new DataView(headData.buffer).setUint32(8, 0xdeadbeef) // stale checkSumAdjustment
  new DataView(headData.buffer).setUint16(18, 2048) // unitsPerEm
  const glyfData = new Uint8Array([1, 2, 3, 4, 5, 6, 7])
  const cmapData = new Uint8Array([9, 9])

  const headerSize = 12 + 2 * 4
  const dir0 = headerSize
  const dir1 = dir0 + 12 + 2 * 16
  const dataStart = dir1 + 12 + 2 * 16
  const headOffset = dataStart
  const glyfOffset = headOffset + headData.byteLength
  const cmapOffset = glyfOffset + glyfData.byteLength
  const total = cmapOffset + cmapData.byteLength

  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x74746366) // 'ttcf'
  view.setUint32(4, 0x00020000)
  view.setUint32(8, 2)
  view.setUint32(12, dir0)
  view.setUint32(16, dir1)

  const writeFace = (offset: number, tables: readonly [number, number, number][]) => {
    view.setUint32(offset, SFNT_TRUE_TYPE)
    view.setUint16(offset + 4, tables.length)
    tables.forEach(([tag, tableOffset, length], index) => {
      const record = offset + 12 + index * 16
      view.setUint32(record, tag)
      view.setUint32(record + 4, 0)
      view.setUint32(record + 8, tableOffset)
      view.setUint32(record + 12, length)
    })
  }
  // Face 0 uses head+glyf; face 1 shares glyf and adds cmap.
  writeFace(dir0, [
    [HEAD_TAG, headOffset, headData.byteLength],
    [GLYF_TAG, glyfOffset, glyfData.byteLength],
  ])
  writeFace(dir1, [
    [GLYF_TAG, glyfOffset, glyfData.byteLength],
    [0x636d6170, cmapOffset, cmapData.byteLength],
  ])

  bytes.set(headData, headOffset)
  bytes.set(glyfData, glyfOffset)
  bytes.set(cmapData, cmapOffset)
  return bytes
}

function parseTables(face: Uint8Array): Map<number, { offset: number; length: number }> {
  const view = new DataView(face.buffer, face.byteOffset, face.byteLength)
  const numTables = view.getUint16(4)
  const tables = new Map<number, { offset: number; length: number }>()
  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16
    tables.set(view.getUint32(record), {
      offset: view.getUint32(record + 8),
      length: view.getUint32(record + 12),
    })
  }
  return tables
}

function sfntChecksum(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let sum = 0
  for (let index = 0; index < bytes.byteLength >> 2; index += 1) {
    sum = (sum + view.getUint32(index * 4)) >>> 0
  }
  return sum >>> 0
}

describe('extractTtcFace', () => {
  it('repacks a collection face into a standalone parseable sfnt', () => {
    const face = extractTtcFace(buildCollection(), 0)
    const view = new DataView(face.buffer, face.byteOffset, face.byteLength)

    expect(view.getUint32(0)).toBe(SFNT_TRUE_TYPE)
    expect(view.getUint16(4)).toBe(2)

    const tables = parseTables(face)
    expect([...tables.keys()].sort()).toEqual([GLYF_TAG, HEAD_TAG].sort())
    for (const { offset, length } of tables.values()) {
      expect(offset).toBeGreaterThanOrEqual(12 + 2 * 16)
      expect(offset % 4).toBe(0)
      expect(offset + length).toBeLessThanOrEqual(face.byteLength)
    }
  })

  it('copies shared table data and preserves unitsPerEm', () => {
    const face = extractTtcFace(buildCollection(), 1)
    const tables = parseTables(face)
    const glyf = tables.get(GLYF_TAG)
    expect(glyf).toBeDefined()
    expect([...face.subarray(glyf!.offset, glyf!.offset + glyf!.length)]).toEqual([1, 2, 3, 4, 5, 6, 7])

    const withHead = extractTtcFace(buildCollection(), 0)
    const headOffset = parseTables(withHead).get(HEAD_TAG)!.offset
    const headView = new DataView(withHead.buffer, withHead.byteOffset, withHead.byteLength)
    expect(headView.getUint16(headOffset + 18)).toBe(2048)
  })

  it('recomputes head.checkSumAdjustment for the repacked file', () => {
    const face = extractTtcFace(buildCollection(), 0)
    const headOffset = parseTables(face).get(HEAD_TAG)!.offset
    const view = new DataView(face.buffer, face.byteOffset, face.byteLength)
    const adjustment = view.getUint32(headOffset + 8)

    expect(adjustment).not.toBe(0xdeadbeef)
    const zeroed = face.slice()
    new DataView(zeroed.buffer).setUint32(headOffset + 8, 0)
    expect(adjustment).toBe((0xb1b0afba - sfntChecksum(zeroed)) >>> 0)
  })

  it('rejects non-collections, out-of-range faces, and truncated buffers', () => {
    const collection = buildCollection()
    expect(() => extractTtcFace(collection, 2)).toThrow('FONT_TTC_FACE_OUT_OF_RANGE')
    expect(() => extractTtcFace(collection, -1)).toThrow('FONT_TTC_FACE_OUT_OF_RANGE')
    expect(() => extractTtcFace(new Uint8Array(8), 0)).toThrow('FONT_TTC_TRUNCATED')

    const notCollection = new Uint8Array(32)
    new DataView(notCollection.buffer).setUint32(0, SFNT_TRUE_TYPE)
    expect(() => extractTtcFace(notCollection, 0)).toThrow('FONT_NOT_TTC')

    const truncated = collection.slice(0, collection.byteLength - 4)
    expect(() => extractTtcFace(truncated, 1)).toThrow('FONT_TTC_TRUNCATED')
  })
})

describe('flux-font:// request validation', () => {
  it('accepts only allowlisted logical keys', () => {
    for (const key of FONT_KEYS) {
      expect(resolveFontRequestKey(`flux-font://face/${key}`)).toBe(key)
      expect(isFontKey(key)).toBe(true)
    }
  })

  it('rejects unknown keys, traversal, other hosts, and authority spoofing', () => {
    const rejected = [
      'flux-font://face/unknown',
      'flux-font://face/',
      'flux-font://face/sc/extra',
      'flux-font://face/../../../windows/win.ini',
      'flux-font://face/%2e%2e%2f%2e%2e%2fwin.ini',
      'flux-font://face/%2e%2e%5cwin.ini',
      'flux-font://face/C:%5CWindows%5CFonts%5Csimhei.ttf',
      'flux-font://face/sc%00',
      'flux-font://face/%E0%A4%A',
      'flux-font://other/sc',
      'flux-font://user@face/sc',
      'flux-font://face:443/sc',
      'flux-font://face.evil.example/sc',
      'flux-font://face/sc?url=http://evil.example',
      'flux-font://face/sc#frag',
      'flux-media://face/sc',
      'https://face/sc',
      'not a url',
    ]
    for (const url of rejected) expect(resolveFontRequestKey(url), url).toBeNull()
  })

  it('rejects unsupported methods before touching the filesystem', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = await handleFontRequest(new Request('flux-font://face/sc', { method }))
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('GET, HEAD')
    }
  })

  it('allows only the packaged renderer and loopback Vite origins', () => {
    expect(resolveFontResponseOrigin(new Request('flux-font://face/sc'))).toBe('flux://app')
    for (const origin of ['flux://app', 'http://localhost:5173', 'http://127.0.0.1:4173']) {
      const request = new Request('flux-font://face/sc', { headers: { Origin: origin } })
      expect(resolveFontResponseOrigin(request)).toBe(origin)
    }
    for (const origin of [
      'https://example.com',
      'http://localhost.evil.example:5173',
      'http://127.0.0.2:5173',
      'http://localhost',
    ]) {
      const request = new Request('flux-font://face/sc', { headers: { Origin: origin } })
      expect(resolveFontResponseOrigin(request)).toBeNull()
    }
  })

  it('rejects font reads from an untrusted renderer origin', async () => {
    const response = await handleFontRequest(
      new Request('flux-font://face/sc', { headers: { Origin: 'https://example.com' } }),
    )
    expect(response.status).toBe(403)
  })

  it('404s unknown keys instead of falling through', async () => {
    const response = await handleFontRequest(new Request('flux-font://face/nope'))
    expect(response.status).toBe(404)
  })

  it('serves an allowlisted key with locked-down headers, or 404s when absent', async () => {
    const response = await handleFontRequest(new Request('flux-font://face/latin'))

    // System fonts exist on Windows dev machines but not on a bare CI image; both are valid.
    expect([200, 404]).toContain(response.status)
    if (response.status !== 200) return
    expect(response.headers.get('content-type')).toBe('font/ttf')
    expect(response.headers.get('access-control-allow-origin')).toBe('flux://app')
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')

    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(1024)
    const signature = new DataView(bytes.buffer, 0, 4).getUint32(0)
    // three-text's FontLoader only accepts these two signatures.
    expect([SFNT_TRUE_TYPE, 0x4f54544f]).toContain(signature)
  })
})

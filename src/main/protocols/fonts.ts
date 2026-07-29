import fs from 'node:fs/promises'
import path from 'node:path'
import { FONT_SCHEME } from './constants'

/**
 * Per-script system font faces for the 3D lyric layer. Keys are the only accepted
 * request targets — the renderer never names a path, so there is no traversal surface.
 * Faces must be static (non-variable): three-text enables its two-pass overlap removal
 * for variable fonts, which corrupts dense self-intersecting CJK contours.
 */
export type FontKey = 'latin' | 'sc' | 'jp' | 'kr'

export const FONT_KEYS: readonly FontKey[] = ['latin', 'sc', 'jp', 'kr']

interface FontCandidate {
  /** File name under the platform font directory. */
  readonly file: string
  /** Face index inside a `.ttc` collection; omitted for plain sfnt files. */
  readonly faceIndex?: number
}

const WINDOWS_CANDIDATES: Readonly<Record<FontKey, readonly FontCandidate[]>> = {
  latin: [{ file: 'segoeuib.ttf' }, { file: 'arialbd.ttf' }],
  sc: [{ file: 'simhei.ttf' }, { file: 'msyhbd.ttc', faceIndex: 0 }],
  jp: [
    { file: 'YuGothB.ttc', faceIndex: 0 },
    { file: 'msgothic.ttc', faceIndex: 0 },
  ],
  kr: [{ file: 'malgunbd.ttf' }, { file: 'malgun.ttf' }],
}

const MACOS_CANDIDATES: Readonly<Record<FontKey, readonly FontCandidate[]>> = {
  latin: [{ file: 'HelveticaNeue.ttc', faceIndex: 0 }],
  sc: [{ file: 'PingFang.ttc', faceIndex: 0 }],
  jp: [{ file: 'ヒラギノ角ゴシック W6.ttc', faceIndex: 0 }],
  kr: [{ file: 'AppleSDGothicNeo.ttc', faceIndex: 0 }],
}

function fontDirectories(): readonly string[] {
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
    return [path.join(root, 'Fonts')]
  }
  if (process.platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts']
  return ['/usr/share/fonts', '/usr/local/share/fonts']
}

function candidatesFor(key: FontKey): readonly FontCandidate[] {
  if (process.platform === 'win32') return WINDOWS_CANDIDATES[key]
  if (process.platform === 'darwin') return MACOS_CANDIDATES[key]
  return []
}

export function isFontKey(value: string): value is FontKey {
  return (FONT_KEYS as readonly string[]).includes(value)
}

const SFNT_TRUE_TYPE = 0x00010000
const SFNT_CFF = 0x4f54544f
const TTC_TAG = 0x74746366
const HEAD_TAG = 0x68656164
const CHECKSUM_MAGIC = 0xb1b0afba

function alignedLength(length: number): number {
  return (length + 3) & ~3
}

function sfntChecksum(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let sum = 0
  const fullWords = bytes.byteLength >> 2
  for (let index = 0; index < fullWords; index += 1) {
    sum = (sum + view.getUint32(index * 4)) >>> 0
  }
  const remainder = bytes.byteLength & 3
  if (remainder > 0) {
    let tail = 0
    for (let index = 0; index < 4; index += 1) {
      const byteIndex = fullWords * 4 + index
      tail = ((tail << 8) | (byteIndex < bytes.byteLength ? bytes[byteIndex] : 0)) >>> 0
    }
    sum = (sum + tail) >>> 0
  }
  return sum >>> 0
}

/**
 * Repack one face of a TrueType Collection into a standalone sfnt.
 *
 * three-text's FontLoader only accepts the `0x00010000` and `OTTO` signatures and
 * rejects `ttcf` outright, so collection faces (YuGothB.ttc, msyhbd.ttc, ...) must be
 * flattened first. Table data is copied contiguously with fresh 4-byte-aligned offsets,
 * shared tables included, and `head.checkSumAdjustment` recomputed for the new file.
 */
export function extractTtcFace(buffer: ArrayBuffer | Uint8Array, faceIndex: number): Uint8Array {
  const source = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength)
  if (source.byteLength < 16) throw new Error('FONT_TTC_TRUNCATED')
  if (view.getUint32(0) !== TTC_TAG) throw new Error('FONT_NOT_TTC')
  const faceCount = view.getUint32(8)
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= faceCount) {
    throw new Error('FONT_TTC_FACE_OUT_OF_RANGE')
  }
  const directoryOffset = view.getUint32(12 + faceIndex * 4)
  if (directoryOffset + 12 > source.byteLength) throw new Error('FONT_TTC_TRUNCATED')

  const sfntVersion = view.getUint32(directoryOffset)
  if (sfntVersion !== SFNT_TRUE_TYPE && sfntVersion !== SFNT_CFF) throw new Error('FONT_TTC_BAD_FACE')
  const numTables = view.getUint16(directoryOffset + 4)
  if (numTables === 0) throw new Error('FONT_TTC_BAD_FACE')

  interface TableRecord {
    tag: number
    checksum: number
    offset: number
    length: number
  }
  const tables: TableRecord[] = []
  for (let index = 0; index < numTables; index += 1) {
    const record = directoryOffset + 12 + index * 16
    if (record + 16 > source.byteLength) throw new Error('FONT_TTC_TRUNCATED')
    const table: TableRecord = {
      tag: view.getUint32(record),
      checksum: view.getUint32(record + 4),
      offset: view.getUint32(record + 8),
      length: view.getUint32(record + 12),
    }
    if (table.offset + table.length > source.byteLength) throw new Error('FONT_TTC_TRUNCATED')
    tables.push(table)
  }
  // The table directory must be sorted by tag; TTC face directories already are, but
  // sorting keeps the output valid for collections that are not.
  tables.sort((a, b) => a.tag - b.tag)

  const headerSize = 12 + numTables * 16
  let total = headerSize
  for (const table of tables) total += alignedLength(table.length)
  const output = new Uint8Array(total)
  const outputView = new DataView(output.buffer)

  // Binary search fields per the sfnt spec: highest power of two <= numTables.
  let searchRange = 1
  let entrySelector = 0
  while (searchRange * 2 <= numTables) {
    searchRange *= 2
    entrySelector += 1
  }
  outputView.setUint32(0, sfntVersion)
  outputView.setUint16(4, numTables)
  outputView.setUint16(6, searchRange * 16)
  outputView.setUint16(8, entrySelector)
  outputView.setUint16(10, numTables * 16 - searchRange * 16)

  let cursor = headerSize
  let headOffset = -1
  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index]
    const record = 12 + index * 16
    outputView.setUint32(record, table.tag)
    outputView.setUint32(record + 4, table.checksum)
    outputView.setUint32(record + 8, cursor)
    outputView.setUint32(record + 12, table.length)
    output.set(source.subarray(table.offset, table.offset + table.length), cursor)
    if (table.tag === HEAD_TAG) headOffset = cursor
    cursor += alignedLength(table.length)
  }

  if (headOffset >= 0 && headOffset + 12 <= output.byteLength) {
    outputView.setUint32(headOffset + 8, 0)
    const adjustment = (CHECKSUM_MAGIC - sfntChecksum(output)) >>> 0
    outputView.setUint32(headOffset + 8, adjustment)
  }
  return output
}

function isSfnt(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false
  const signature = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0)
  return signature === SFNT_TRUE_TYPE || signature === SFNT_CFF
}

const faceCache = new Map<FontKey, Uint8Array>()
const pendingFaces = new Map<FontKey, Promise<Uint8Array | null>>()

async function readCandidate(candidate: FontCandidate): Promise<Uint8Array | null> {
  for (const directory of fontDirectories()) {
    const filePath = path.join(directory, candidate.file)
    let bytes: Buffer
    try {
      bytes = await fs.readFile(filePath)
    } catch {
      continue
    }
    const source = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    try {
      if (path.extname(candidate.file).toLowerCase() === '.ttc') {
        return extractTtcFace(source, candidate.faceIndex ?? 0)
      }
    } catch (error) {
      console.warn(`[fonts] TTC 抽取失败 ${candidate.file}:`, error)
      continue
    }
    if (isSfnt(source)) return new Uint8Array(source)
  }
  return null
}

async function loadFace(key: FontKey): Promise<Uint8Array | null> {
  const cached = faceCache.get(key)
  if (cached) return cached
  const pending = pendingFaces.get(key)
  if (pending) return pending
  const task = (async () => {
    for (const candidate of candidatesFor(key)) {
      const face = await readCandidate(candidate)
      if (face) {
        faceCache.set(key, face)
        return face
      }
    }
    return null
  })().finally(() => pendingFaces.delete(key))
  pendingFaces.set(key, task)
  return task
}

export function resolveFontRequestKey(requestUrl: string): FontKey | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (
    url.protocol !== `${FONT_SCHEME}:` ||
    url.hostname !== 'face' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return null
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  const key = decoded.replace(/^\/+/, '')
  return isFontKey(key) ? key : null
}

const DEVELOPMENT_RENDERER_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/

/** Keep the font endpoint readable only by the packaged renderer and local Vite dev servers. */
export function resolveFontResponseOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin')
  if (!origin) return 'flux://app'
  if (origin === 'flux://app' || DEVELOPMENT_RENDERER_ORIGIN.test(origin)) return origin
  return null
}

export async function handleFontRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  const key = resolveFontRequestKey(request.url)
  if (!key) return new Response('Not found', { status: 404 })
  const responseOrigin = resolveFontResponseOrigin(request)
  if (!responseOrigin) return new Response('Forbidden', { status: 403 })
  let face: Uint8Array | null
  try {
    face = await loadFace(key)
  } catch (error) {
    console.warn(`[fonts] 读取系统字体失败 ${key}:`, error)
    return new Response('Font unavailable', { status: 404 })
  }
  if (!face) return new Response('Font unavailable', { status: 404 })

  const headers = new Headers({
    'Access-Control-Allow-Origin': responseOrigin,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': String(face.byteLength),
    'Content-Type': 'font/ttf',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
  // Copy so the response never aliases the cached face buffer.
  return new Response(face.slice().buffer as ArrayBuffer, { status: 200, headers })
}

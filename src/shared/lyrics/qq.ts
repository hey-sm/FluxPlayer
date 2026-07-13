function entityCodePoint(value: string, radix: number, fallback: string): string {
  const codePoint = Number.parseInt(value, radix)
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : fallback
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (entity: string, hex: string) => entityCodePoint(hex, 16, entity))
    .replace(/&#(\d+);/g, (entity: string, decimal: string) => entityCodePoint(decimal, 10, entity))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
}

function base64Bytes(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')

  try {
    if (typeof globalThis.atob === 'function') {
      const binary = globalThis.atob(padded)
      return Uint8Array.from(binary, (character) => character.charCodeAt(0))
    }

    const runtime = globalThis as typeof globalThis & {
      Buffer?: { from(input: string, encoding: string): { values(): IterableIterator<number> } }
    }
    if (runtime.Buffer) return Uint8Array.from(runtime.Buffer.from(padded, 'base64').values())
  } catch {
    return null
  }

  return null
}

function decodeBase64Utf8(value: string): string | null {
  const bytes = base64Bytes(value)
  if (!bytes) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return null
  }
}

function looksLikeDecodedLyric(value: string): boolean {
  return /(?:^|\n)\s*\[(?:\d{1,3}:\d{1,2}|\d+,\d+)/.test(value) || /[\u3400-\u9fff]/u.test(value)
}

/**
 * Decode QQ's optional UTF-8 base64 lyric payload in Node or a browser.
 * Plain LRC and malformed base64 are returned as normalized text instead of throwing.
 */
export function decodeQQLyric(input: unknown): string {
  let raw = decodeHtmlEntities(String(input ?? '').trim())
  if (!raw) return ''

  const compact = raw.replace(/\s+/g, '')
  const couldBeBase64 =
    !/^\s*\[/.test(raw) &&
    compact.length >= 8 &&
    compact.length % 4 !== 1 &&
    /^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)

  if (couldBeBase64) {
    const decoded = decodeBase64Utf8(compact)
    if (decoded && looksLikeDecodedLyric(decoded)) raw = decoded
  }

  return decodeHtmlEntities(raw).replace(/\r\n?/g, '\n').trim()
}

export { decodeHtmlEntities as decodeLyricHtmlEntities }

import type { LyricLine, LyricWord } from '../models'

const LRC_TIMESTAMP = /\[(?:(\d{1,2}):)?(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const INLINE_TIMESTAMP = /<(?:(\d{1,2}):)?\d+:\d{1,2}(?:[.:]\d{1,3})?>/g
const YRC_LINE = /^\s*\[(\d+),(\d+)\](.*)$/
const YRC_WORD = /\((\d+),(\d+)(?:,\d+)?\)([^()]*)/g
const QRC_LINE = /^\s*\[(\d+),(\d+)\](.*)$/
const QRC_SEGMENT = /(.+?)\((\d+),(\d+)\)/g
const OFFSET_TAG = /\[offset\s*:\s*([+-]?\d+)\s*\]/gi

/**
 * NetEase's newer lyric API returns a mixed format: metadata lines (作词/作曲 etc.)
 * are JSON objects `{"t":0,"c":[{"tx":"作词: "},{"tx":"周杰伦","li":"...","or":"..."}]}`
 * while actual lyric lines remain in the traditional `[mm:ss.ms]text` (LRC) or
 * `[ms,dur](ms,dur,0)字(ms,dur,0)字` (YRC) format.
 *
 * This function extracts { time, text } from a JSON metadata line, or returns null
 * if the line is not in JSON format.
 */
function parseNeteaseJsonLine(row: string): { time: number; text: string } | null {
  const trimmed = row.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const obj = JSON.parse(trimmed) as { t?: number; c?: Array<{ tx?: string }> }
    if (typeof obj.t !== 'number' || !Array.isArray(obj.c)) return null
    const text = obj.c.map((segment) => segment.tx ?? '').join('').trim()
    return { time: obj.t / 1000, text }
  } catch {
    return null
  }
}

export interface ParseLrcOptions {
  /** Additional offset in milliseconds, applied after an optional [offset:*] tag. */
  offsetMs?: number
}

export interface MergeLyricOptions {
  /** Maximum difference in seconds when pairing an original and translated line. */
  tolerance?: number
}

export interface BuildLyricLinesOptions extends ParseLrcOptions, MergeLyricOptions {
  /** Prefer enhanced NetEase YRC line timing over regular LRC when available. */
  preferYrc?: boolean
}

export interface LegacyLyrics {
  readonly lyric?: unknown
  readonly tlyric?: unknown
  readonly yrc?: unknown
  readonly qrc?: unknown
}

function fractionToSeconds(value: string | undefined): number {
  if (!value) return 0
  return Number(value) / 10 ** value.length
}

function timestampToSeconds(match: RegExpExecArray): number {
  const hours = Number(match[1] || 0)
  const minutes = Number(match[2] || 0)
  const seconds = Number(match[3] || 0)
  return hours * 3600 + minutes * 60 + seconds + fractionToSeconds(match[4])
}

function finiteOffset(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0
}

function sortLines(lines: Array<LyricLine & { order: number }>): LyricLine[] {
  return lines.sort((a, b) => a.time - b.time || a.order - b.order).map(({ order: _order, ...line }) => line)
}

function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
      (part) => part.segment,
    )
  }
  return Array.from(text)
}

/**
 * Estimate per-character timings from line-level timestamps.
 *
 * Uses heuristics that better match natural vocal rhythm than equal distribution:
 * - Latin letter runs are grouped into word tokens (not split per-letter) so
 *   the sweep glides across a word instead of stuttering letter-by-letter.
 * - CJK characters are the primary unit; each gets weight 1.
 * - Punctuation gets minimal duration and acts as a micro-pause.
 * - A leading pickup delay (up to 0.25s for short lines) models the breath
 *   before a line starts; a trailing rest gap models the breath before the next.
 * - A gentle curve gives slightly more time to the first few characters
 * (vocal onset) and slightly less to the last few (line taper).
 *
 * Purely algorithmic — no audio analysis. Results carry `estimated: true`.
 */

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff]/
const PUNCT_CHARS = /^[，。！？、,.!?；：；""''…—–\-\s]$/
const LATIN_LETTER = /[a-zA-Z]/
const DIGIT = /[0-9]/

/** Split text into display tokens: CJK = 1 char, Latin = whole word, digits = whole number, punct = 1 char. */
function tokenizeForLyrics(text: string): string[] {
  const chars = graphemes(text)
  const tokens: string[] = []
  let latinRun = ''
  let digitRun = ''
  const flushLatin = () => { if (latinRun) { tokens.push(latinRun); latinRun = '' } }
  const flushDigit = () => { if (digitRun) { tokens.push(digitRun); digitRun = '' } }
  for (const ch of chars) {
    if (PUNCT_CHARS.test(ch)) {
      flushLatin(); flushDigit()
      tokens.push(ch)
    } else if (LATIN_LETTER.test(ch)) {
      flushDigit()
      latinRun += ch
    } else if (DIGIT.test(ch)) {
      flushLatin()
      digitRun += ch
    } else {
      flushLatin(); flushDigit()
      tokens.push(ch)
    }
  }
  flushLatin(); flushDigit()
  return tokens
}

function tokenWeight(token: string): number {
  if (PUNCT_CHARS.test(token)) return 0.12
  if (/^\s$/.test(token)) return 0.08
  if (CJK_RANGE.test(token)) return 1
  if (DIGIT.test(token)) return token.length * 0.6
  if (LATIN_LETTER.test(token)) return Math.max(0.6, token.length * 0.5)
  return 0.8
}

export function estimateWordTimings(lines: readonly LyricLine[], fallbackDuration = 4): LyricLine[] {
  return lines.map((line, index) => {
    if (line.words?.length || !line.text) return { ...line, words: line.words?.map((word) => ({ ...word })) }
    const tokens = tokenizeForLyrics(line.text)
    if (!tokens.length) return { ...line }
    const nextTime = lines[index + 1]?.time
    const fullDuration = Math.max(
      0.4,
      Number.isFinite(nextTime) ? Number(nextTime) - line.time : fallbackDuration,
    )

    // Leading pickup delay: short lines have a proportionally larger breath.
    // Long lines (> 10 tokens) barely breathe; 2-4 token lines rest up to 0.25s.
    const pickupDelay = Math.min(0.25, fullDuration * Math.max(0.03, 0.15 - tokens.length * 0.01))
    // Trailing rest gap: 4% of remaining duration, capped at 0.3s.
    const restGap = Math.min(0.3, (fullDuration - pickupDelay) * 0.04)
    const duration = Math.max(0.2, fullDuration - pickupDelay - restGap)

    const weights = tokens.map(tokenWeight)

    // Gentle curve: front-heavy for onset, tail-taper for line-end.
    const n = weights.length
    const curvedWeights = weights.map((w, i) => {
      if (n <= 1) return w
      const t = i / (n - 1) // 0..1
      const curve = 1 + 0.12 * (1 - t) - 0.08 * t
      return w * curve
    })

    const total = curvedWeights.reduce((sum, value) => sum + value, 0)
    let cursor = line.time + pickupDelay
    const words: LyricWord[] = tokens.map((text, i): LyricWord => {
      const wordDuration = (duration * curvedWeights[i]) / total
      const word = { text, time: cursor, duration: wordDuration, estimated: true as const }
      cursor += wordDuration
      return word
    })
    return { ...line, words }
  })
}

/**
 * Parse standard LRC plus enhanced-LRC inline word timestamps.
 * Timed empty lines are retained so callers can intentionally clear the previous line.
 */
export function parseLrc(input: unknown, options: ParseLrcOptions = {}): LyricLine[] {
  const source = typeof input === 'string' ? input.replace(/^\uFEFF/, '') : ''
  if (!source) return []

  let documentOffsetMs = 0
  for (const match of source.matchAll(OFFSET_TAG)) documentOffsetMs = Number(match[1]) || 0
  const offsetSeconds = (documentOffsetMs + finiteOffset(options.offsetMs)) / 1000
  const parsed: Array<LyricLine & { order: number }> = []
  let order = 0

  for (const row of source.split(/\r?\n/)) {
    // NetEase JSON metadata line: {"t":0,"c":[{"tx":"作词: "},{"tx":"周杰伦"}]}
    const jsonLine = parseNeteaseJsonLine(row)
    if (jsonLine) {
      parsed.push({ time: Math.max(0, jsonLine.time + offsetSeconds), text: jsonLine.text, order })
      order += 1
      continue
    }

    const times: number[] = []
    LRC_TIMESTAMP.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = LRC_TIMESTAMP.exec(row))) times.push(timestampToSeconds(match))
    if (times.length === 0) continue

    LRC_TIMESTAMP.lastIndex = 0
    const text = row.replace(LRC_TIMESTAMP, '').replace(OFFSET_TAG, '').replace(INLINE_TIMESTAMP, '').trim()
    for (const time of times) {
      parsed.push({ time: Math.max(0, time + offsetSeconds), text, order })
      order += 1
    }
  }

  return sortLines(parsed)
}

/** Parse NetEase enhanced YRC line/word timing into the common line model. */
export function parseYrc(input: unknown, options: ParseLrcOptions = {}): LyricLine[] {
  const source = typeof input === 'string' ? input.replace(/^\uFEFF/, '') : ''
  if (!source) return []

  const offsetSeconds = finiteOffset(options.offsetMs) / 1000
  const parsed: Array<LyricLine & { order: number }> = []
  let order = 0

  for (const row of source.split(/\r?\n/)) {
    // NetEase JSON metadata line in YRC field
    const jsonLine = parseNeteaseJsonLine(row)
    if (jsonLine) {
      parsed.push({ time: Math.max(0, jsonLine.time + offsetSeconds), text: jsonLine.text, order })
      order += 1
      continue
    }

    const match = row.match(YRC_LINE)
    if (!match) continue
    const time = Math.max(0, Number(match[1]) / 1000 + offsetSeconds)
    const words: LyricWord[] = []
    YRC_WORD.lastIndex = 0
    let wordMatch: RegExpExecArray | null
    while ((wordMatch = YRC_WORD.exec(match[3]))) {
      const text = wordMatch[3]
      if (!text) continue
      const tokenTime = Math.max(0, Number(wordMatch[1]) / 1000 + offsetSeconds)
      const tokenDuration = Math.max(0, Number(wordMatch[2]) / 1000)
      const characters = graphemes(text)
      const characterDuration = characters.length ? tokenDuration / characters.length : tokenDuration
      characters.forEach((character, characterIndex) =>
        words.push({
          text: character,
          time: tokenTime + characterDuration * characterIndex,
          duration: characterDuration,
        }),
      )
    }
    const text = words.length
      ? words
          .map((word) => word.text)
          .join('')
          .trim()
      : match[3].replace(YRC_WORD, '').trim()
    parsed.push({ time, text, ...(words.length ? { words } : {}), order })
    order += 1
  }

  return sortLines(parsed)
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCharCode(Number(decimal)))
}

function qrcContent(input: string): string {
  const element = input.match(/<LyricContent\b[^>]*>([\s\S]*?)<\/LyricContent\s*>/i)
  if (element) return decodeXmlEntities(element[1])
  const attribute = input.match(/\bLyricContent\s*=\s*(["'])([\s\S]*?)\1/i)
  return attribute ? decodeXmlEntities(attribute[2]) : input
}

/** Parse QQ's QRC XML or its embedded `[start,duration]... (start,duration)` payload. */
export function parseQrc(input: unknown, options: ParseLrcOptions = {}): LyricLine[] {
  const source = typeof input === 'string' ? qrcContent(input.replace(/^\uFEFF/, '')) : ''
  if (!source) return []

  const offsetSeconds = finiteOffset(options.offsetMs) / 1000
  const parsed: Array<LyricLine & { order: number }> = []
  let order = 0

  for (const row of source.split(/\r?\n/)) {
    const lineMatch = row.match(QRC_LINE)
    if (!lineMatch) continue
    const lineTime = Math.max(0, Number(lineMatch[1]) / 1000 + offsetSeconds)
    const words: LyricWord[] = []
    QRC_SEGMENT.lastIndex = 0
    let segmentMatch: RegExpExecArray | null
    while ((segmentMatch = QRC_SEGMENT.exec(lineMatch[3]))) {
      const text = segmentMatch[1]
      if (!text) continue
      words.push({
        text,
        time: Math.max(0, Number(segmentMatch[2]) / 1000 + offsetSeconds),
        duration: Math.max(0, Number(segmentMatch[3]) / 1000),
      })
    }
    if (words.length === 0) continue
    const text = words
      .map((word) => word.text)
      .join('')
      .trim()
    if (!text) continue
    parsed.push({ time: lineTime, text, words, order })
    order += 1
  }

  return sortLines(parsed)
}

/** Parse either enhanced YRC or regular/enhanced LRC, preferring YRC when recognized. */
export function parseLyricText(input: unknown, options: ParseLrcOptions = {}): LyricLine[] {
  const qrc = parseQrc(input, options)
  if (qrc.length > 0) return qrc
  const yrc = parseYrc(input, options)
  return yrc.length > 0 ? yrc : parseLrc(input, options)
}

/**
 * Merge translations into original lines without mutating either input.
 * Matching is stable, nearest-within-tolerance, and one-to-one (including duplicate timestamps).
 */
export function mergeLyricLines(
  original: readonly LyricLine[],
  translated: readonly LyricLine[],
  options: MergeLyricOptions = {},
): LyricLine[] {
  if (original.length === 0) return translated.map(({ time, text }) => ({ time, text }))
  if (translated.length === 0) return original.map((line) => ({ ...line }))

  const tolerance = Number.isFinite(options.tolerance) ? Math.max(0, Number(options.tolerance)) : 0.35
  const candidates: Array<{ originalIndex: number; translatedIndex: number; difference: number }> = []
  for (let originalIndex = 0; originalIndex < original.length; originalIndex += 1) {
    for (let translatedIndex = 0; translatedIndex < translated.length; translatedIndex += 1) {
      const difference = Math.abs(original[originalIndex].time - translated[translatedIndex].time)
      if (difference <= tolerance) candidates.push({ originalIndex, translatedIndex, difference })
    }
  }
  candidates.sort(
    (a, b) =>
      a.difference - b.difference ||
      a.originalIndex - b.originalIndex ||
      a.translatedIndex - b.translatedIndex,
  )

  const matches = new Map<number, number>()
  const usedTranslations = new Set<number>()
  for (const candidate of candidates) {
    if (matches.has(candidate.originalIndex) || usedTranslations.has(candidate.translatedIndex)) continue
    matches.set(candidate.originalIndex, candidate.translatedIndex)
    usedTranslations.add(candidate.translatedIndex)
  }

  return original.map((line, index) => {
    const translatedIndex = matches.get(index)
    if (translatedIndex === undefined) return { ...line }
    const ttext = translated[translatedIndex].text.trim()
    return ttext ? { ...line, ttext } : { ...line }
  })
}

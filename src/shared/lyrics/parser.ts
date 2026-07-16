import type { LyricLine, LyricWord } from '../models'

const LRC_TIMESTAMP = /\[(?:(\d{1,2}):)?(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const INLINE_TIMESTAMP = /<(?:(\d{1,2}):)?\d+:\d{1,2}(?:[.:]\d{1,3})?>/g
const YRC_LINE = /^\s*\[(\d+),(\d+)\](.*)$/
const YRC_WORD = /\((\d+),(\d+)(?:,\d+)?\)([^()]*)/g
const OFFSET_TAG = /\[offset\s*:\s*([+-]?\d+)\s*\]/gi

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
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((part) => part.segment)
  }
  return Array.from(text)
}

export function estimateWordTimings(lines: readonly LyricLine[], fallbackDuration = 4): LyricLine[] {
  return lines.map((line, index) => {
    if (line.words?.length || !line.text) return { ...line, words: line.words?.map((word) => ({ ...word })) }
    const segments = graphemes(line.text)
    if (!segments.length) return { ...line }
    const nextTime = lines[index + 1]?.time
    const duration = Math.max(0.4, Number.isFinite(nextTime) ? Number(nextTime) - line.time : fallbackDuration)
    const weights = segments.map((value) => (/^\s|[，。！？、,.!?]$/.test(value) ? 0.45 : 1))
    const total = weights.reduce((sum, value) => sum + value, 0)
    let cursor = line.time
    const words = segments.map((text, wordIndex): LyricWord => {
      const wordDuration = duration * weights[wordIndex] / total
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
      characters.forEach((character, characterIndex) => words.push({
        text: character,
        time: tokenTime + characterDuration * characterIndex,
        duration: characterDuration,
      }))
    }
    const text = words.length ? words.map((word) => word.text).join('').trim() : match[3].replace(YRC_WORD, '').trim()
    parsed.push({ time, text, ...(words.length ? { words } : {}), order })
    order += 1
  }

  return sortLines(parsed)
}

/** Parse either enhanced YRC or regular/enhanced LRC, preferring YRC when recognized. */
export function parseLyricText(input: unknown, options: ParseLrcOptions = {}): LyricLine[] {
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

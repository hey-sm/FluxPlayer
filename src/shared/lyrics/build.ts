import type { LyricLine } from '../models'
import { decodeQQLyric } from './qq'
import { mergeLyricLines, parseLrc, parseYrc, type BuildLyricLinesOptions, type LegacyLyrics } from './parser'

function lyricString(value: unknown): string {
  return decodeQQLyric(value)
}

/** Build normalized lines from a legacy `{ lyric, tlyric, yrc }` response without mutating it. */
export function buildLyricLines(
  legacy: Readonly<LegacyLyrics>,
  options: BuildLyricLinesOptions = {},
): LyricLine[] {
  const regular = parseLrc(lyricString(legacy.lyric), options)
  const enhanced = parseYrc(lyricString(legacy.yrc), options)
  const original = options.preferYrc === false || enhanced.length === 0 ? regular : enhanced
  const translated = parseLrc(lyricString(legacy.tlyric), options)
  const hasOriginalText = original.some((line) => line.text.trim())

  return mergeLyricLines(hasOriginalText ? original : translated, hasOriginalText ? translated : [], options)
}

/** Return a shallow copy with computed lines while preserving every raw legacy field verbatim. */
export function withLyricLines<T extends LegacyLyrics>(
  legacy: Readonly<T>,
  options: BuildLyricLinesOptions = {},
): T & { lines: LyricLine[] } {
  return { ...legacy, lines: buildLyricLines(legacy, options) } as T & { lines: LyricLine[] }
}

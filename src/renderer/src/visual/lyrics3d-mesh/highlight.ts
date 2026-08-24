import type { LyricWord } from '@shared/models'

function graphemeCount(text: string): number {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    let count = 0
    for (const segment of seg.segment(text)) {
      void segment
      count++
    }
    return count
  }
  return Array.from(text).length
}

/**
 * Map playback position to a glyph-space progress value [0, glyphCount].
 *
 * Each LyricWord may span multiple glyphs (e.g. a Latin word "hello" = 5 glyphs).
 * The progress is computed per-word, then expanded into glyph space so the
 * sweep glides smoothly across multi-glyph tokens instead of jumping.
 */
export function lyricGlyphProgress(
  words: readonly LyricWord[] | undefined,
  position: number,
  glyphCount: number,
): number {
  if (!words?.length || !Number.isFinite(position) || glyphCount <= 0) return 0

  // Precompute each word's glyph count.
  let totalGlyphs = 0
  const wordGlyphs: number[] = []
  for (const word of words) {
    const count = graphemeCount(word.text)
    wordGlyphs.push(count)
    totalGlyphs += count
  }
  if (totalGlyphs === 0) return 0

  // Walk words, accumulating glyph-space progress.
  let glyphProgress = 0
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    const wg = wordGlyphs[index]
    if (position < word.time) break
    const duration = Math.max(word.duration, 0.001)
    // Use a small epsilon to avoid floating-point drift at word boundaries
    // (e.g. 2.4 - 2.0 = 0.39999... → fraction = 0.99999... instead of 1).
    const fraction = position >= word.time + duration - 0.001
      ? 1
      : Math.min(1, Math.max(0, (position - word.time) / duration))
    glyphProgress += wg * fraction
    if (fraction < 1) break // still inside this word
    // Word fully passed — all its glyphs are lit.
  }

  // If the shaped glyph count matches the total word glyphs exactly,
  // return the raw glyph progress to avoid floating-point drift.
  if (totalGlyphs === glyphCount) return Math.min(glyphCount, glyphProgress)

  return Math.min(glyphCount, (glyphProgress / totalGlyphs) * glyphCount)
}

import type { LyricWord } from '@shared/models'

export function lyricGlyphProgress(
  words: readonly LyricWord[] | undefined,
  position: number,
  glyphCount: number,
): number {
  if (!words?.length || !Number.isFinite(position) || glyphCount <= 0) return 0

  let wordProgress = 0
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    if (position < word.time) break
    const duration = Math.max(word.duration, 0.001)
    wordProgress = index + Math.min(1, Math.max(0, (position - word.time) / duration))
    if (position < word.time + duration) break
    wordProgress = index + 1
  }

  return Math.min(glyphCount, (wordProgress / words.length) * glyphCount)
}

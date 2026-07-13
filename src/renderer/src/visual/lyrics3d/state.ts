import type { LyricLine } from '@shared/models'

export interface Lyrics3DWindowEntry {
  index: number
  relativeIndex: number
  line: LyricLine
}

export interface Lyrics3DState {
  trackKey: string | null
  activeIndex: number
  windowStart: number
  windowEnd: number
}

export interface Lyrics3DStateInput {
  trackKey: string | null
  lines: readonly LyricLine[]
  position: number
  visible: boolean
}

export const EMPTY_LYRICS_3D_STATE: Readonly<Lyrics3DState> = {
  trackKey: null,
  activeIndex: -1,
  windowStart: -1,
  windowEnd: -1,
}

/** Last timestamp not after the playback position wins, including duplicate timestamps. */
export function findActiveLyricIndex(lines: readonly LyricLine[], position: number): number {
  if (lines.length === 0 || !Number.isFinite(position)) return -1

  let low = 0
  let high = lines.length - 1
  let activeIndex = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (lines[middle].time <= position) {
      activeIndex = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return activeIndex
}

/** Returns a bounded current-line-centered window without copying lyric lines. */
export function selectLyricWindow(
  lines: readonly LyricLine[],
  activeIndex: number,
  before = 2,
  after = 2,
): Lyrics3DWindowEntry[] {
  if (activeIndex < 0 || activeIndex >= lines.length) return []

  const start = Math.max(0, activeIndex - Math.max(0, Math.floor(before)))
  const end = Math.min(lines.length - 1, activeIndex + Math.max(0, Math.floor(after)))
  const entries: Lyrics3DWindowEntry[] = []
  for (let index = start; index <= end; index += 1) {
    entries.push({ index, relativeIndex: index - activeIndex, line: lines[index] })
  }
  return entries
}

/** Pure frame reduction keeps immediate track-switch clearing independently testable. */
export function deriveLyrics3DState(
  previous: Readonly<Lyrics3DState>,
  input: Readonly<Lyrics3DStateInput>,
  radius = 2,
): Lyrics3DState {
  if (!input.visible || input.trackKey === null) {
    return { trackKey: input.trackKey, activeIndex: -1, windowStart: -1, windowEnd: -1 }
  }

  const activeIndex = findActiveLyricIndex(input.lines, input.position)
  if (activeIndex < 0) {
    return { trackKey: input.trackKey, activeIndex: -1, windowStart: -1, windowEnd: -1 }
  }

  const boundedRadius = Math.max(0, Math.floor(radius))
  return {
    trackKey: input.trackKey,
    activeIndex,
    windowStart: Math.max(0, activeIndex - boundedRadius),
    windowEnd: Math.min(input.lines.length - 1, activeIndex + boundedRadius),
  }
}

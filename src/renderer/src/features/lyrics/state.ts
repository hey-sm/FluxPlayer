import type { LyricLine } from '@shared/models'
import type { LyricTrackKey } from './paths'

export interface LyricsTrackState {
  trackKey: LyricTrackKey | null
  lines: readonly LyricLine[]
}

export type LyricsTrackAction =
  | { type: 'switch'; trackKey: LyricTrackKey | null }
  | { type: 'load'; trackKey: LyricTrackKey | null; lines: readonly LyricLine[] }
  | { type: 'clear'; trackKey: LyricTrackKey | null }

export function createLyricsTrackState(
  trackKey: LyricTrackKey | null,
  lines: readonly LyricLine[] = [],
): LyricsTrackState {
  return { trackKey, lines: lines.map((line) => ({ ...line })) }
}

/** Reducer is exported so stale-result and track-switch clearing behavior stays unit-testable. */
export function lyricsTrackReducer(state: LyricsTrackState, action: LyricsTrackAction): LyricsTrackState {
  if (action.type === 'switch') {
    return action.trackKey === state.trackKey ? state : { trackKey: action.trackKey, lines: [] }
  }
  if (action.trackKey !== state.trackKey) return state
  if (action.type === 'clear') return state.lines.length === 0 ? state : { ...state, lines: [] }
  return { ...state, lines: action.lines.map((line) => ({ ...line })) }
}

/** Last timestamp not after position wins; duplicate timestamps therefore resolve deterministically. */
export function currentLyricLineIndex(lines: readonly LyricLine[], position: number): number {
  if (lines.length === 0 || !Number.isFinite(position)) return -1
  let low = 0
  let high = lines.length - 1
  let result = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (lines[middle].time <= position) {
      result = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return result
}

const INSTRUMENTAL_MARKERS = new Set([
  '纯音乐请欣赏',
  '暂无歌词',
  '暂无歌词敬请期待',
  '此歌曲为没有填词的纯音乐请您欣赏',
])

function compactText(value: string): string {
  return value.replace(/\s+/g, '').replace(/[，,。.!！?？、~～]/g, '')
}

export function isInstrumentalLyrics(lines: readonly LyricLine[]): boolean {
  const texts = lines.flatMap((line) => [line.text, line.ttext ?? '']).filter((text) => text.trim())
  return texts.length > 0 && texts.every((text) => INSTRUMENTAL_MARKERS.has(compactText(text)))
}

export type LyricsLoadState = 'idle' | 'loading' | 'success' | 'error'
export type LyricsEmptyState = 'none' | 'idle' | 'loading' | 'error' | 'instrumental' | 'empty'

export function lyricsEmptyState(
  lines: readonly LyricLine[],
  loadState: LyricsLoadState,
  instrumental = false,
): LyricsEmptyState {
  if (loadState === 'loading') return 'loading'
  if (loadState === 'error') return 'error'
  if (loadState === 'idle') return 'idle'
  if (instrumental || isInstrumentalLyrics(lines)) return 'instrumental'
  return lines.some((line) => line.text.trim() || line.ttext?.trim()) ? 'none' : 'empty'
}

export { LYRICS_QUERY_SCOPE, lyricPath, lyricQueryKey, lyricTrackKey } from './paths'
export type { LyricsQueryKey, LyricTrackKey } from './paths'
export { normalizeLyricDoc, useLyrics } from './query'
export type { UseLyricsOptions, UseLyricsResult } from './query'
export {
  createLyricsTrackState,
  currentLyricLineIndex,
  isInstrumentalLyrics,
  lyricsEmptyState,
  lyricsTrackReducer,
} from './state'
export type { LyricsEmptyState, LyricsLoadState, LyricsTrackAction, LyricsTrackState } from './state'

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { buildLyricLines } from '@shared/lyrics'
import type { LyricDoc, LyricLine, UnifiedSong } from '@shared/models'
import { apiJson } from '../../api'
import { lyricPath, lyricQueryKey, lyricTrackKey, type LyricTrackKey } from './paths'
import type { LyricsLoadState } from './state'

interface LyricWireDoc extends Omit<Partial<LyricDoc>, 'lyric' | 'tlyric' | 'yrc'> {
  lyric?: unknown
  tlyric?: unknown
  yrc?: unknown
  [key: string]: unknown
}

function rawString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function validServerLines(value: unknown): LyricLine[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((line) => {
    if (!line || typeof line !== 'object') return []
    const candidate = line as Partial<LyricLine>
    if (!Number.isFinite(candidate.time) || typeof candidate.text !== 'string') return []
    return [
      candidate.ttext === undefined
        ? { time: Number(candidate.time), text: candidate.text }
        : { time: Number(candidate.time), text: candidate.text, ttext: String(candidate.ttext) },
    ]
  })
}

/** Normalize a legacy-compatible wire response while preserving all original raw fields. */
export function normalizeLyricDoc(raw: LyricWireDoc, song: UnifiedSong): LyricDoc {
  const lyric = rawString(raw.lyric)
  const tlyric = rawString(raw.tlyric)
  const yrc = rawString(raw.yrc)
  const builtLines = buildLyricLines({ lyric, tlyric, yrc })
  const lines = builtLines.length > 0 ? builtLines : validServerLines(raw.lines)

  return {
    ...raw,
    provider: raw.provider ?? song.provider,
    id: raw.id ?? song.id,
    mid: raw.mid ?? song.mid ?? song.songmid,
    lyric,
    tlyric,
    yrc,
    lines,
    source: rawString(raw.source) || `${song.provider}-empty`,
  }
}

export interface UseLyricsOptions {
  enabled?: boolean
}

export type UseLyricsResult = UseQueryResult<LyricDoc, Error> & {
  trackKey: LyricTrackKey | null
  path: string | null
  loadState: LyricsLoadState
}

/** Stable per-track lyric loader. Query-key changes synchronously drop the previous query's data. */
export function useLyrics(
  song: UnifiedSong | null | undefined,
  options: UseLyricsOptions = {},
): UseLyricsResult {
  const path = lyricPath(song)
  const trackKey = lyricTrackKey(song)
  const query = useQuery<LyricDoc, Error>({
    queryKey: lyricQueryKey(song),
    enabled: options.enabled !== false && Boolean(song && path && trackKey),
    queryFn: async () => {
      if (!song || !path) throw new Error('歌词请求缺少歌曲标识')
      return normalizeLyricDoc(await apiJson<LyricWireDoc>(path), song)
    },
  })

  const loadState: LyricsLoadState =
    options.enabled === false || !song || !path || !trackKey
      ? 'idle'
      : query.isError
        ? 'error'
        : query.isSuccess
          ? 'success'
          : 'loading'

  return { ...query, trackKey, path, loadState }
}

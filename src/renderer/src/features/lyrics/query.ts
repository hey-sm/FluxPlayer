import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { buildLyricLines } from '@shared/lyrics'
import type { LyricDoc, LyricLine, LyricWord, UnifiedSong } from '@shared/models'
import { getLyrics } from '../../api'
import { lyricQueryKey, lyricTrackKey, lyricsRequest, type LyricTrackKey } from './paths'
import type { LyricsLoadState } from './state'

interface LyricWireDoc extends Omit<Partial<LyricDoc>, 'lyric' | 'tlyric' | 'yrc'> {
  lyric?: unknown
  tlyric?: unknown
  yrc?: unknown
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
    const words: LyricWord[] | undefined = Array.isArray(candidate.words)
      ? candidate.words.flatMap((word) => {
          if (
            !word ||
            typeof word !== 'object' ||
            typeof word.text !== 'string' ||
            !Number.isFinite(word.time) ||
            !Number.isFinite(word.duration)
          ) {
            return []
          }
          return [
            {
              text: word.text,
              time: Number(word.time),
              duration: Math.max(0, Number(word.duration)),
              ...(word.estimated === true ? { estimated: true } : {}),
            },
          ]
        })
      : undefined
    return [
      {
        time: Number(candidate.time),
        text: candidate.text,
        ...(candidate.ttext === undefined ? {} : { ttext: String(candidate.ttext) }),
        ...(words?.length ? { words } : {}),
      },
    ]
  })
}

export function normalizeLyricDoc(raw: LyricWireDoc, song: UnifiedSong): LyricDoc {
  const lyric = rawString(raw.lyric)
  const tlyric = rawString(raw.tlyric)
  const yrc = rawString(raw.yrc)
  const builtLines = buildLyricLines({ lyric, tlyric, yrc })
  return {
    ...raw,
    provider: raw.provider ?? song.provider,
    id: raw.id ?? song.id,
    mid: raw.mid ?? song.mid ?? song.songmid,
    lyric,
    tlyric,
    yrc,
    lines: builtLines.length > 0 ? builtLines : validServerLines(raw.lines),
    source: rawString(raw.source) || `${song.provider}-empty`,
  }
}

export interface UseLyricsOptions {
  enabled?: boolean
}

export type UseLyricsResult = UseQueryResult<LyricDoc, Error> & {
  trackKey: LyricTrackKey | null
  loadState: LyricsLoadState
}

export function useLyrics(
  song: UnifiedSong | null | undefined,
  options: UseLyricsOptions = {},
): UseLyricsResult {
  const request = lyricsRequest(song)
  const trackKey = lyricTrackKey(song)
  const query = useQuery<LyricDoc, Error>({
    queryKey: lyricQueryKey(song),
    enabled: options.enabled !== false && Boolean(song && request && trackKey),
    queryFn: async ({ signal }) => {
      if (!song || !request) throw new Error('歌词请求缺少歌曲标识')
      return normalizeLyricDoc(await getLyrics(request, signal), song)
    },
  })

  const loadState: LyricsLoadState =
    options.enabled === false || !song || !request || !trackKey
      ? 'idle'
      : query.isError
        ? 'error'
        : query.isSuccess
          ? 'success'
          : 'loading'

  return { ...query, trackKey, loadState }
}

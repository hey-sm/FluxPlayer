import type { UnifiedSong } from '@shared/models'
import type { LyricsRequest } from '@shared/music-contract'

export const LYRICS_QUERY_SCOPE = 'lyrics' as const
export type LyricTrackKey = string
export type LyricsQueryKey = readonly [typeof LYRICS_QUERY_SCOPE, LyricTrackKey | 'none']

function value(input: unknown): string {
  return String(input ?? '').trim()
}

export function lyricTrackKey(song: UnifiedSong | null | undefined): LyricTrackKey | null {
  if (!song) return null
  if (song.provider === 'qq') {
    const mid = value(song.mid || song.songmid)
    const id = value(song.qqId || song.id)
    if (!mid && !id) return null
    return `qq:${mid}:${id}`
  }

  const id = value(song.id)
  return id ? `netease:${id}` : null
}

export function lyricsRequest(song: UnifiedSong | null | undefined): LyricsRequest | null {
  if (!song) return null
  if (song.provider === 'qq') {
    const mid = value(song.mid || song.songmid || song.id)
    const id = song.qqId ?? song.id
    return mid || value(id) ? { provider: 'qq', id, mid: mid || undefined } : null
  }

  return value(song.id) ? { provider: 'netease', id: song.id } : null
}

export function lyricQueryKey(song: UnifiedSong | null | undefined): LyricsQueryKey {
  return [LYRICS_QUERY_SCOPE, lyricTrackKey(song) ?? 'none'] as const
}

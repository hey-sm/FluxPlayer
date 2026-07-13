import type { UnifiedSong } from '@shared/models'

export const LYRICS_QUERY_SCOPE = 'lyrics' as const
export type LyricTrackKey = string
export type LyricsQueryKey = readonly [typeof LYRICS_QUERY_SCOPE, LyricTrackKey | 'none']

function value(value: unknown): string {
  return String(value ?? '').trim()
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

/** Existing server route only; this module never invents or rewrites provider APIs. */
export function lyricPath(song: UnifiedSong | null | undefined): string | null {
  if (!song) return null
  if (song.provider === 'qq') {
    const mid = value(song.mid || song.songmid || song.id)
    const id = value(song.qqId || (/^\d+$/.test(value(song.id)) ? song.id : ''))
    if (!mid && !id) return null
    return `/api/qq/lyric?mid=${encodeURIComponent(mid)}&id=${encodeURIComponent(id)}`
  }

  const id = value(song.id)
  return id ? `/api/lyric?id=${encodeURIComponent(id)}` : null
}

export function lyricQueryKey(song: UnifiedSong | null | undefined): LyricsQueryKey {
  return [LYRICS_QUERY_SCOPE, lyricTrackKey(song) ?? 'none'] as const
}

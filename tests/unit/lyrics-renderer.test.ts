import { describe, expect, it } from 'vitest'
import type { UnifiedSong } from '@shared/models'
import {
  createLyricsTrackState,
  currentLyricLineIndex,
  lyricPath,
  lyricQueryKey,
  lyricTrackKey,
  lyricsEmptyState,
  lyricsTrackReducer,
  normalizeLyricDoc,
} from '@renderer/features/lyrics'

function song(overrides: Partial<UnifiedSong> = {}): UnifiedSong {
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: 123,
    name: 'Song',
    artist: 'Artist',
    artists: [{ name: 'Artist' }],
    album: 'Album',
    cover: '',
    duration: 120,
    ...overrides,
  }
}

describe('lyric route and query contract', () => {
  it('uses the real NetEase lyric route and a stable key', () => {
    const current = song({ id: '12 3' })
    expect(lyricPath(current)).toBe('/api/lyric?id=12%203')
    expect(lyricTrackKey(current)).toBe('netease:12 3')
    expect(lyricQueryKey(current)).toEqual(['lyrics', 'netease:12 3'])
  })

  it('uses the real QQ lyric route with both mid and numeric id', () => {
    const current = song({
      provider: 'qq',
      source: 'qq',
      id: 'fallback-mid',
      qqId: 456,
      mid: '003 mid',
      songmid: 'ignored',
    })
    expect(lyricPath(current)).toBe('/api/qq/lyric?mid=003%20mid&id=456')
    expect(lyricTrackKey(current)).toBe('qq:003 mid:456')
  })

  it('normalizes legacy responses into lines without replacing raw fields', () => {
    const raw = {
      lyric: '[00:01]Hello',
      tlyric: '[00:01.1]你好',
      yrc: '',
      source: 'lyric_new',
      opaque: { keep: true },
    }
    const normalized = normalizeLyricDoc(raw, song())
    expect(normalized).toMatchObject({
      ...raw,
      provider: 'netease',
      id: 123,
      lines: [{ time: 1, text: 'Hello', ttext: '你好' }],
    })
    expect(normalized.opaque).toBe(raw.opaque)
  })
})

describe('time-driven lyric selection', () => {
  const lines = [
    { time: 1, text: 'one' },
    { time: 2, text: 'two-a' },
    { time: 2, text: 'two-b' },
    { time: 5, text: 'five' },
  ]

  it('returns no current line before the first timestamp', () => {
    expect(currentLyricLineIndex(lines, 0.999)).toBe(-1)
    expect(currentLyricLineIndex([], 10)).toBe(-1)
    expect(currentLyricLineIndex(lines, Number.NaN)).toBe(-1)
  })

  it('selects the latest line and the last duplicate at a timestamp', () => {
    expect(currentLyricLineIndex(lines, 1)).toBe(0)
    expect(currentLyricLineIndex(lines, 2)).toBe(2)
    expect(currentLyricLineIndex(lines, 99)).toBe(3)
  })
})

describe('track switching and empty states', () => {
  it('clears immediately on switch and rejects a stale previous-track load', () => {
    const initial = createLyricsTrackState('netease:1', [{ time: 1, text: 'old' }])
    const switched = lyricsTrackReducer(initial, { type: 'switch', trackKey: 'netease:2' })
    expect(switched).toEqual({ trackKey: 'netease:2', lines: [] })

    const stale = lyricsTrackReducer(switched, {
      type: 'load',
      trackKey: 'netease:1',
      lines: [{ time: 2, text: 'must not leak' }],
    })
    expect(stale).toBe(switched)
  })

  it('accepts only the active track result after a switch', () => {
    const switched = createLyricsTrackState('qq:new')
    expect(
      lyricsTrackReducer(switched, {
        type: 'load',
        trackKey: 'qq:new',
        lines: [{ time: 0, text: 'new' }],
      }),
    ).toEqual({ trackKey: 'qq:new', lines: [{ time: 0, text: 'new' }] })
  })

  it('distinguishes loading, error, instrumental, and empty states', () => {
    expect(lyricsEmptyState([], 'loading')).toBe('loading')
    expect(lyricsEmptyState([], 'error')).toBe('error')
    expect(lyricsEmptyState([{ time: 0, text: '纯音乐，请欣赏' }], 'success')).toBe('instrumental')
    expect(lyricsEmptyState([], 'success')).toBe('empty')
    expect(lyricsEmptyState([{ time: 1, text: 'real lyric' }], 'success')).toBe('none')
  })
})

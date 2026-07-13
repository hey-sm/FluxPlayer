import { describe, expect, it } from 'vitest'
import {
  normalizePlaylistListResponse,
  normalizePlaylistTracksResponse,
} from '@renderer/features/playlist/api'
import { playlistQueryKeys } from '@renderer/features/playlist/queries'
import { calculateWindow } from '@renderer/features/playlist/window'

describe('playlist query keys', () => {
  it('isolates providers and account identities', () => {
    expect(playlistQueryKeys.list('netease', 'user:1', 60)).not.toEqual(
      playlistQueryKeys.list('qq', 'user:1', 60),
    )
    expect(playlistQueryKeys.tracks('qq', 'uin:1', 12)).not.toEqual(
      playlistQueryKeys.tracks('qq', 'uin:2', 12),
    )
    expect(playlistQueryKeys.tracks('qq', 'uin:1', 12)).toEqual(['playlist', 'qq', 'uin:1', 'tracks', '12'])
  })
})

describe('playlist response normalization', () => {
  it('keeps current fields and accepts legacy aliases', () => {
    const result = normalizePlaylistListResponse(
      {
        loggedIn: true,
        userId: 7,
        playlists: [
          { id: 1, name: 'Current', cover: 'a', trackCount: 2 },
          { disstid: 'q2', dissname: 'Legacy', logo: 'b', songnum: '3', visitnum: 9 },
          { id: 3 },
          null,
        ],
      },
      'qq',
    )
    expect(result.identity).toBe('7')
    expect(result.playlists).toHaveLength(2)
    expect(result.playlists[1]).toMatchObject({
      id: 'q2',
      name: 'Legacy',
      cover: 'b',
      trackCount: 3,
      playCount: 9,
      provider: 'qq',
    })
  })

  it('normalizes nested legacy tracks and drops malformed records', () => {
    const result = normalizePlaylistTracksResponse(
      {
        data: {
          songs: [
            { id: 1, name: 'Mapped', artist: 'Artist', album: 'Album', duration: 1000 },
            { songmid: 'mid2', songname: 'QQ old', singer: [{ mid: 's1', name: 'Singer' }], interval: 9 },
            { id: 3 },
            undefined,
          ],
        },
      },
      'qq',
    )
    expect(result.tracks).toHaveLength(2)
    expect(result.tracks[0]).toMatchObject({ provider: 'qq', source: 'qq', name: 'Mapped', duration: 1000 })
    expect(result.tracks[1]).toMatchObject({ id: 'mid2', artist: 'Singer', duration: 9000 })
  })

  it('is safe for null and malformed response bodies', () => {
    expect(normalizePlaylistListResponse(null, 'netease').playlists).toEqual([])
    expect(normalizePlaylistTracksResponse({ tracks: 'bad' }, 'netease').tracks).toEqual([])
  })
})

describe('fixed-row playlist window', () => {
  it('renders a small slice for 100+ tracks', () => {
    const slice = calculateWindow(500, 56 * 200, 560, 56, 5)
    expect(slice).toEqual({ start: 195, end: 215, offsetTop: 10920, offsetBottom: 15960 })
    expect(slice.end - slice.start).toBeLessThan(30)
  })

  it('clamps beginning, end, empty and invalid values', () => {
    expect(calculateWindow(120, -50, 112, 56, 2)).toMatchObject({ start: 0, end: 6, offsetTop: 0 })
    expect(calculateWindow(120, 999999, 112, 56, 2)).toEqual({
      start: 120,
      end: 120,
      offsetTop: 6720,
      offsetBottom: 0,
    })
    expect(calculateWindow(0, 0, 0, 0)).toEqual({ start: 0, end: 0, offsetTop: 0, offsetBottom: 0 })
  })
})

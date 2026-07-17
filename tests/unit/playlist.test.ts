import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaylistListResult, PlaylistTracksResult } from '@shared/music-contract'
import type { UnifiedPlaylist, UnifiedSong } from '@shared/models'
import { fetchPlaylists, fetchPlaylistTracks } from '@renderer/features/playlist/api'
import {
  createPlaylistListQuery,
  createPlaylistTracksQuery,
  lastPlaylistStorageKey,
  playlistQueryKeys,
  prefetchLastPlaylist,
} from '@renderer/features/playlist/queries'
import { calculateWindow } from '@renderer/features/playlist/window'
import { getPlaylists, getPlaylistTracks } from '@renderer/api'

const apiMock = vi.hoisted(() => ({
  getPlaylists: vi.fn(),
  getPlaylistTracks: vi.fn(),
}))

vi.mock('@renderer/api', () => ({
  getPlaylists: apiMock.getPlaylists,
  getPlaylistTracks: apiMock.getPlaylistTracks,
}))

const playlist: UnifiedPlaylist = {
  provider: 'qq',
  id: 'playlist-1',
  name: 'Typed playlist',
  cover: '',
  trackCount: 1,
}

const song: UnifiedSong = {
  provider: 'qq',
  type: 'song',
  id: 'song-1',
  name: 'Typed song',
  artist: 'Artist',
  artists: [{ name: 'Artist' }],
  album: 'Album',
  cover: '',
  duration: 1000,
}

const listResult: PlaylistListResult = {
  provider: 'qq',
  loggedIn: true,
  identity: '42',
  playlists: [playlist],
}

const tracksResult: PlaylistTracksResult = {
  provider: 'qq',
  loggedIn: true,
  playlist,
  tracks: [song],
}

beforeEach(() => {
  vi.restoreAllMocks()
  apiMock.getPlaylists.mockReset().mockResolvedValue(listResult)
  apiMock.getPlaylistTracks.mockReset().mockResolvedValue(tracksResult)
})

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

describe('typed playlist data flow', () => {
  it('forwards strict list and track requests with their AbortSignals', async () => {
    const listController = new AbortController()
    const tracksController = new AbortController()

    await expect(fetchPlaylists('qq', 60, listController.signal)).resolves.toBe(listResult)
    await expect(fetchPlaylistTracks('qq', 'playlist-1', tracksController.signal)).resolves.toBe(tracksResult)

    expect(getPlaylists).toHaveBeenCalledWith({ provider: 'qq', limit: 60 }, listController.signal)
    expect(getPlaylistTracks).toHaveBeenCalledWith(
      { provider: 'qq', id: 'playlist-1' },
      tracksController.signal,
    )
  })

  it('returns strict IPC results unchanged', async () => {
    const receivedList = await fetchPlaylists('qq', 60)
    const receivedTracks = await fetchPlaylistTracks('qq', 'playlist-1')

    expect(receivedList).toBe(listResult)
    expect(receivedTracks).toBe(tracksResult)
    expect(receivedList.playlists[0]).toEqual(playlist)
    expect(receivedTracks.tracks[0]).toEqual(song)
  })

  it('loads playlist tracks only when the detail query is executed', async () => {
    const listQuery = createPlaylistListQuery('qq', 'user:42', 60)
    const tracksQuery = createPlaylistTracksQuery('qq', 'user:42', 'playlist-1')

    expect(getPlaylists).not.toHaveBeenCalled()
    expect(getPlaylistTracks).not.toHaveBeenCalled()

    const listSignal = new AbortController().signal
    await listQuery.queryFn({ signal: listSignal } as never)
    expect(getPlaylists).toHaveBeenCalledOnce()
    expect(getPlaylistTracks).not.toHaveBeenCalled()

    const tracksSignal = new AbortController().signal
    await tracksQuery.queryFn({ signal: tracksSignal } as never)
    expect(getPlaylistTracks).toHaveBeenCalledOnce()
    expect(getPlaylistTracks).toHaveBeenCalledWith({ provider: 'qq', id: 'playlist-1' }, tracksSignal)
  })

  it('prefetches at most the single last-opened playlist instead of warming every playlist', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const playlists: UnifiedPlaylist[] = [
      playlist,
      { ...playlist, id: 'playlist-2', name: 'Second playlist' },
      { ...playlist, id: 'playlist-3', name: 'Third playlist' },
    ]
    const storage = {
      getItem: vi.fn((key: string) =>
        key === lastPlaylistStorageKey('qq', 'user:42') ? 'playlist-2' : null,
      ),
    }

    await prefetchLastPlaylist(queryClient, 'qq', 'user:42', playlists, storage)

    expect(getPlaylistTracks).toHaveBeenCalledOnce()
    expect(getPlaylistTracks).toHaveBeenCalledWith(
      { provider: 'qq', id: 'playlist-2' },
      expect.any(AbortSignal),
    )
    queryClient.clear()
  })

  it('does not prefetch tracks when there is no remembered playlist', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    await prefetchLastPlaylist(queryClient, 'qq', 'user:42', [playlist], {
      getItem: () => null,
    })

    expect(getPlaylistTracks).not.toHaveBeenCalled()
    queryClient.clear()
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

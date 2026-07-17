import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FluxMusicApi, MusicSearchResult } from '@shared/music-contract'
import type { UnifiedSong } from '@shared/models'
import {
  abortable,
  getLikedTracks,
  getPlaylistTracks,
  getPlaylists,
  musicClient,
  musicErrorMessage,
  normalizeCoverSource,
  searchMusic,
} from '@renderer/api'

const song: UnifiedSong = {
  provider: 'qq',
  type: 'song',
  id: 'song-1',
  name: 'Typed song',
  artist: 'Artist',
  artists: [{ name: 'Artist' }],
  album: 'Album',
  cover: '',
  duration: 180_000,
}

const searchResult: MusicSearchResult = { provider: 'qq', songs: [song] }

function createMusicBridge(): { [K in keyof FluxMusicApi]: ReturnType<typeof vi.fn> } {
  return {
    search: vi.fn().mockResolvedValue(searchResult),
    resolvePlayback: vi.fn(),
    getLyrics: vi.fn(),
    getAuthStatus: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getPlaylists: vi.fn().mockResolvedValue({
      provider: 'netease',
      loggedIn: true,
      identity: '7',
      playlists: [],
    }),
    getPlaylistTracks: vi.fn().mockResolvedValue({
      provider: 'qq',
      playlist: null,
      tracks: [],
    }),
    getLikedTracks: vi.fn().mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      identity: '9',
      tracks: [],
      offset: 0,
      limit: 50,
      total: 0,
      hasMore: false,
    }),
  }
}

let bridge: ReturnType<typeof createMusicBridge>

beforeEach(() => {
  bridge = createMusicBridge()
  vi.stubGlobal('window', { fluxDesktop: { music: bridge } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('typed renderer music client', () => {
  it('forwards typed requests to window.fluxDesktop.music without HTTP URL construction', async () => {
    await expect(searchMusic({ provider: 'qq', keywords: 'typed', limit: 20 })).resolves.toEqual(searchResult)
    await getPlaylists({ provider: 'netease', limit: 60 })
    await getPlaylistTracks({ provider: 'qq', id: 'playlist-1' })
    await getLikedTracks({ provider: 'qq', offset: 10, limit: 25 })

    expect(bridge.search).toHaveBeenCalledWith({ provider: 'qq', keywords: 'typed', limit: 20 })
    expect(bridge.getPlaylists).toHaveBeenCalledWith({ provider: 'netease', limit: 60 })
    expect(bridge.getPlaylistTracks).toHaveBeenCalledWith({ provider: 'qq', id: 'playlist-1' })
    expect(bridge.getLikedTracks).toHaveBeenCalledWith({ provider: 'qq', offset: 10, limit: 25 })
  })

  it('exposes the complete typed musicClient bridge for auth and playback operations', async () => {
    bridge.getAuthStatus.mockResolvedValue({ provider: 'qq', loggedIn: false })
    bridge.login.mockResolvedValue({ provider: 'qq', loggedIn: true, userId: '42' })
    bridge.logout.mockResolvedValue(undefined)
    bridge.resolvePlayback.mockResolvedValue({
      provider: 'qq',
      url: 'flux-media://audio/opaque-handle',
      trial: false,
      playable: true,
    })

    await musicClient.getAuthStatus('qq')
    await musicClient.login('qq')
    await musicClient.logout('qq')
    await musicClient.resolvePlayback({ song, quality: 'standard' })

    expect(bridge.getAuthStatus).toHaveBeenCalledWith('qq')
    expect(bridge.login).toHaveBeenCalledWith('qq')
    expect(bridge.logout).toHaveBeenCalledWith('qq')
    expect(bridge.resolvePlayback).toHaveBeenCalledWith({ song, quality: 'standard' })
  })

  it('rejects an aborted query and suppresses its late IPC result', async () => {
    let resolveSearch!: (result: MusicSearchResult) => void
    bridge.search.mockReturnValue(
      new Promise<MusicSearchResult>((resolve) => {
        resolveSearch = resolve
      }),
    )
    const controller = new AbortController()
    const pending = searchMusic({ provider: 'qq', keywords: 'first' }, controller.signal)

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    resolveSearch(searchResult)
    await Promise.resolve()
    expect(bridge.search).toHaveBeenCalledTimes(1)
  })

  it('rejects immediately when an AbortSignal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(abortable(Promise.resolve('stale'), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('maps stable IPC error codes to renderer-owned product copy', () => {
    expect(
      musicErrorMessage(new Error('Error invoking remote method: PROVIDER_UNAVAILABLE'), 'fallback'),
    ).toBe('音乐服务暂时不可用，请稍后重试')
    expect(musicErrorMessage(new Error('local audio error'), 'fallback')).toBe('local audio error')
    expect(musicErrorMessage(null, 'fallback')).toBe('fallback')
  })

  it('fails closed when the sandboxed preload music bridge is unavailable', () => {
    vi.stubGlobal('window', { fluxDesktop: {} })
    expect(() => musicClient.search({ provider: 'netease', keywords: 'missing' })).toThrow(
      'FluxPlayer music bridge is unavailable',
    )
  })
})

describe('cover source normalization', () => {
  it('accepts only absolute remote covers and upgrades them to HTTPS', () => {
    expect(normalizeCoverSource('?n=1')).toBe('')
    expect(normalizeCoverSource('/local-cover.jpg')).toBe('')
    expect(normalizeCoverSource('//qpic.y.qq.com/cover/300')).toBe('https://qpic.y.qq.com/cover/300')
    expect(normalizeCoverSource('http://y.gtimg.cn/cover.jpg?n=1')).toBe('https://y.gtimg.cn/cover.jpg?n=1')
  })
})

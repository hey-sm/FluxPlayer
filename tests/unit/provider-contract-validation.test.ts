import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LikedTracksResult,
  MusicAuthResult,
  PlaylistListResult,
  PlaylistTracksResult,
} from '@shared/music-contract'
import type { ProviderId, UnifiedPlaylist, UnifiedSong } from '@shared/models'
import { MusicService, MusicServiceError, musicErrorCode } from '@server/music'
import { QQClient } from '@server/providers/qq/client'
import { QQProvider } from '@server/providers/qq'
import type { CredentialStore, UpstreamPlaybackResource } from '@server/types'

const credentials: CredentialStore = {
  get: vi.fn(() => ''),
  set: vi.fn(),
}

const providers = ['netease', 'qq'] as const

function song(provider: ProviderId): UnifiedSong {
  return {
    provider,
    type: provider === 'qq' ? 'qq' : 'song',
    id: provider === 'qq' ? 'QQ_MID' : 186016,
    mid: provider === 'qq' ? 'QQ_MID' : undefined,
    mediaMid: provider === 'qq' ? 'QQ_MEDIA' : undefined,
    name: `${provider} contract song`,
    artist: 'Contract Artist',
    artists: [{ name: 'Contract Artist' }],
    album: 'Contract Album',
    cover: '',
    duration: 180_000,
  }
}

function playlist(provider: ProviderId): UnifiedPlaylist {
  return {
    provider,
    type: 'playlist',
    id: `${provider}-playlist`,
    name: `${provider} contract playlist`,
    cover: '',
    trackCount: 1,
  }
}

function playback(provider: ProviderId): UpstreamPlaybackResource {
  return {
    provider,
    url: `https://media.example/${provider}/track`,
    headers: { Cookie: 'main-process-only', Referer: 'https://media.example/' },
    trial: false,
    playable: true,
    level: 'exhigh',
    quality: '320k',
    requestedQuality: 'hires',
    diagnostics: { upstream: 'must not cross the service boundary' },
    message: 'provider-only diagnostic',
    error: 'provider-only error',
  }
}

function authResult(provider: ProviderId): MusicAuthResult {
  return { provider, loggedIn: true, userId: `${provider}-user`, nickname: 'Contract User' }
}

function playlistList(provider: ProviderId): PlaylistListResult {
  return { provider, loggedIn: true, identity: `${provider}-user`, playlists: [playlist(provider)] }
}

function playlistTracks(provider: ProviderId): PlaylistTracksResult {
  return { provider, loggedIn: true, playlist: playlist(provider), tracks: [song(provider)] }
}

function likedTracks(provider: ProviderId): LikedTracksResult & {
  error?: string
  message?: string
} {
  return {
    provider,
    loggedIn: true,
    identity: `${provider}-user`,
    tracks: [song(provider)],
    offset: 0,
    limit: 200,
    total: 1,
    hasMore: false,
    error: 'provider-only-error',
    message: 'provider-only-message',
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(credentials.get).mockReturnValue('')
  vi.mocked(credentials.set).mockClear()
})

describe.each(providers)('%s provider shared contract validation', (providerId) => {
  it('uses the same normalized service boundary for search, playback, lyrics, auth, playlists and liked tracks', async () => {
    const service = new MusicService(credentials)
    const selected = service[providerId]
    const otherId: ProviderId = providerId === 'netease' ? 'qq' : 'netease'
    const other = service[otherId]

    const search = vi.spyOn(selected, 'search').mockResolvedValue([song(providerId)])
    const resolvePlayback = vi.spyOn(selected, 'resolvePlayback').mockResolvedValue(playback(providerId))
    const getLyrics = vi.spyOn(selected, 'getLyrics').mockResolvedValue({
      lyric: '[00:00.00]contract',
      tlyric: '',
      yrc: '',
      lines: [{ time: 0, text: 'contract' }],
      source: `${providerId}-contract`,
    })
    const authStatus = vi.spyOn(selected, 'authStatus').mockResolvedValue(authResult(providerId))
    const userPlaylists = vi.spyOn(selected, 'userPlaylists').mockResolvedValue(playlistList(providerId))
    const getPlaylistTracks = vi
      .spyOn(selected, 'playlistTracks')
      .mockResolvedValue(playlistTracks(providerId))
    const getLikedTracks = vi.spyOn(selected, 'likedTracks').mockResolvedValue(likedTracks(providerId))

    const otherCalls = [
      vi.spyOn(other, 'search'),
      vi.spyOn(other, 'resolvePlayback'),
      vi.spyOn(other, 'getLyrics'),
      vi.spyOn(other, 'authStatus'),
      vi.spyOn(other, 'userPlaylists'),
      vi.spyOn(other, 'playlistTracks'),
      vi.spyOn(other, 'likedTracks'),
    ]

    const searchResult = await service.search({
      provider: providerId,
      keywords: '  contract  ',
      limit: 999.9,
    })
    const playbackResult = await service.resolvePlayback({ song: song(providerId), quality: 'hires' })
    const lyricsResult = await service.getLyrics({
      provider: providerId,
      id: song(providerId).id,
      mid: song(providerId).mid,
    })
    const auth = await service.getAuthStatus(providerId)
    const playlists = await service.getPlaylists({ provider: providerId, limit: 0 })
    const tracks = await service.getPlaylistTracks({ provider: providerId, id: 42 })
    const liked = await service.getLikedTracks({ provider: providerId, offset: -4.2, limit: 900 })

    expect(search).toHaveBeenCalledWith('contract', 200)
    expect(searchResult).toEqual({ provider: providerId, songs: [song(providerId)] })

    expect(resolvePlayback).toHaveBeenCalledWith(song(providerId), 'hires')
    expect(playbackResult).toMatchObject({
      provider: providerId,
      upstreamUrl: `https://media.example/${providerId}/track`,
      upstreamHeaders: { Cookie: 'main-process-only' },
      playable: true,
      requestedQuality: 'hires',
    })
    expect(playbackResult).not.toHaveProperty('url')
    expect(playbackResult).not.toHaveProperty('headers')
    expect(playbackResult).not.toHaveProperty('diagnostics')
    expect(playbackResult).not.toHaveProperty('message')
    expect(playbackResult).not.toHaveProperty('error')

    expect(getLyrics).toHaveBeenCalledWith(song(providerId).id, song(providerId).mid)
    expect(lyricsResult).toMatchObject({
      lyric: '[00:00.00]contract',
      lines: [{ time: 0, text: 'contract' }],
    })
    expect(authStatus).toHaveBeenCalledOnce()
    expect(auth).toEqual(authResult(providerId))

    expect(userPlaylists).toHaveBeenCalledWith(1)
    expect(playlists).toEqual(playlistList(providerId))
    expect(getPlaylistTracks).toHaveBeenCalledWith('42')
    expect(tracks).toEqual(playlistTracks(providerId))

    expect(getLikedTracks).toHaveBeenCalledWith(0, 200)
    expect(liked).toEqual({
      provider: providerId,
      loggedIn: true,
      identity: `${providerId}-user`,
      tracks: [song(providerId)],
      offset: 0,
      limit: 200,
      total: 1,
      hasMore: false,
    })
    expect(liked).not.toHaveProperty('error')
    expect(liked).not.toHaveProperty('message')

    for (const call of otherCalls) expect(call).not.toHaveBeenCalled()
  })

  it('normalizes failures from every non-search provider operation to one safe error payload', async () => {
    const operationNames = [
      'playback',
      'lyrics',
      'auth',
      'playlist-list',
      'playlist-tracks',
      'liked-tracks',
    ] as const

    for (const operationName of operationNames) {
      const service = new MusicService(credentials)
      const provider = service[providerId]
      const upstream = { providerPayload: { cookie: 'secret' }, operationName }
      let operation: Promise<unknown>

      switch (operationName) {
        case 'playback':
          vi.spyOn(provider, 'resolvePlayback').mockRejectedValue(upstream)
          operation = service.resolvePlayback({ song: song(providerId), quality: 'standard' })
          break
        case 'lyrics':
          vi.spyOn(provider, 'getLyrics').mockRejectedValue(upstream)
          operation = service.getLyrics({ provider: providerId, id: song(providerId).id })
          break
        case 'auth':
          vi.spyOn(provider, 'authStatus').mockRejectedValue(upstream)
          operation = service.getAuthStatus(providerId)
          break
        case 'playlist-list':
          vi.spyOn(provider, 'userPlaylists').mockRejectedValue(upstream)
          operation = service.getPlaylists({ provider: providerId })
          break
        case 'playlist-tracks':
          vi.spyOn(provider, 'playlistTracks').mockRejectedValue(upstream)
          operation = service.getPlaylistTracks({ provider: providerId, id: 'contract' })
          break
        case 'liked-tracks':
          vi.spyOn(provider, 'likedTracks').mockRejectedValue(upstream)
          operation = service.getLikedTracks({ provider: providerId })
          break
      }

      const error = await operation.catch((reason: unknown) => reason)
      expect(error, operationName).toBeInstanceOf(MusicServiceError)
      expect((error as MusicServiceError).payload, operationName).toEqual({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'UNKNOWN_ERROR',
        provider: providerId,
        retryable: true,
      })
      expect((error as MusicServiceError).payload, operationName).not.toHaveProperty('details')
      expect(musicErrorCode(error), operationName).toBe('PROVIDER_UNAVAILABLE')
    }
  })

  it('rejects an empty login credential before provider auth is queried', async () => {
    const service = new MusicService(credentials)
    const authStatus = vi.spyOn(service[providerId], 'authStatus')

    const error = await service.acceptLoginCredential(providerId, '').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(MusicServiceError)
    expect((error as MusicServiceError).payload).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: `${providerId} login credential is incomplete`,
      provider: providerId,
      retryable: false,
    })
    expect(authStatus).not.toHaveBeenCalled()
  })
})

describe('QQ playback contract validation', () => {
  it('keeps the vkey request and resolves a lower-quality candidate without losing requested quality', async () => {
    const musicuRequest = vi.spyOn(QQClient.prototype, 'musicuRequest').mockResolvedValue({
      req_0: {
        data: {
          sip: ['https://ws.stream.qqmusic.qq.com/'],
          midurlinfo: [
            { filename: 'RS01QQ_MEDIA.flac', purl: '' },
            { filename: 'F000QQ_MEDIA.flac', purl: '' },
            { filename: 'M800QQ_MEDIA.mp3', purl: '' },
            { filename: 'M500QQ_MEDIA.mp3', purl: 'M500QQ_MEDIA.mp3?vkey=DOWNGRADED' },
          ],
        },
      },
    })
    const provider = new QQProvider(credentials)

    const result = await provider.songUrl('QQ_MID', 'QQ_MEDIA', 'hires')

    const payload = musicuRequest.mock.calls[0][0] as {
      req_0: { module: string; method: string; param: { filename: string[] } }
    }
    expect(payload.req_0.module).toBe('vkey.GetVkeyServer')
    expect(payload.req_0.method).toBe('CgiGetVkey')
    expect(payload.req_0.param.filename.slice(0, 5)).toEqual([
      'RS01QQ_MEDIA.flac',
      'F000QQ_MEDIA.flac',
      'M800QQ_MEDIA.mp3',
      'M500QQ_MEDIA.mp3',
      'C400QQ_MEDIA.m4a',
    ])
    expect(result).toMatchObject({
      provider: 'qq',
      playable: true,
      trial: false,
      requestedQuality: 'hires',
      level: 'standard',
      quality: '128k MP3',
      filename: 'M500QQ_MEDIA.mp3',
      url: 'https://ws.stream.qqmusic.qq.com/M500QQ_MEDIA.mp3?vkey=DOWNGRADED',
    })
  })
})

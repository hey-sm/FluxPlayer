import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderId, UnifiedSong } from '@shared/models'
import type { MusicAuthResult } from '@shared/music-contract'
import { MusicService, MusicServiceError } from '@server/music'
import type { CredentialStore, UpstreamPlaybackResource } from '@server/types'

const credentials: CredentialStore = {
  get: vi.fn(() => ''),
  set: vi.fn(),
}

const songs: Record<ProviderId, UnifiedSong> = {
  netease: {
    provider: 'netease',
    type: 'song',
    id: 1,
    name: 'Fixture Song',
    artist: 'Fixture Artist',
    artists: [{ name: 'Fixture Artist' }],
    album: 'Fixture Album',
    cover: '',
    duration: 180_000,
  },
  qq: {
    provider: 'qq',
    type: 'qq',
    id: 'MID',
    mid: 'MID',
    mediaMid: 'MEDIA',
    name: 'Fixture Song',
    artist: 'Fixture Artist',
    artists: [{ name: 'Fixture Artist' }],
    album: 'Fixture Album',
    cover: '',
    duration: 180_000,
  },
}

function playback(provider: ProviderId): UpstreamPlaybackResource {
  return {
    provider,
    url: `https://media.example/${provider}`,
    headers: { Referer: 'https://media.example/' },
    trial: false,
    playable: true,
    requestedQuality: 'exhigh',
  }
}

describe.each<ProviderId>(['netease', 'qq'])('MusicService %s contract', (providerId) => {
  let service: MusicService

  beforeEach(() => {
    vi.restoreAllMocks()
    service = new MusicService(credentials)
  })

  it('maps search, playback and lyrics through the selected provider', async () => {
    const provider = service[providerId]
    vi.spyOn(provider, 'search').mockResolvedValue([songs[providerId]])
    vi.spyOn(provider, 'resolvePlayback').mockResolvedValue(playback(providerId))
    vi.spyOn(provider, 'getLyrics').mockResolvedValue({
      lyric: '[00:00]x',
      tlyric: '',
      yrc: '',
      lines: [],
      source: providerId,
    })

    await expect(service.search({ provider: providerId, keywords: ' fixture ', limit: 20 })).resolves.toEqual(
      {
        provider: providerId,
        songs: [songs[providerId]],
      },
    )
    const resolved = await service.resolvePlayback({ song: songs[providerId], quality: 'exhigh' })
    expect(resolved).toMatchObject({
      provider: providerId,
      playable: true,
      requestedQuality: 'exhigh',
      upstreamUrl: `https://media.example/${providerId}`,
      upstreamHeaders: { Referer: 'https://media.example/' },
    })
    expect(resolved).not.toHaveProperty('url')
    expect(resolved).not.toHaveProperty('headers')
    await expect(
      service.getLyrics({ provider: providerId, id: songs[providerId].id, mid: songs[providerId].mid }),
    ).resolves.toMatchObject({
      lyric: '[00:00]x',
      source: providerId,
    })
  })

  it('maps auth, playlists, playlist tracks and liked tracks to shared contracts', async () => {
    const provider = service[providerId]
    const auth: MusicAuthResult = { provider: providerId, loggedIn: true, userId: 'fixture' }
    vi.spyOn(provider, 'authStatus').mockResolvedValue(auth)
    vi.spyOn(provider, 'userPlaylists').mockResolvedValue({
      provider: providerId,
      loggedIn: true,
      playlists: [],
    })
    vi.spyOn(provider, 'playlistTracks').mockResolvedValue({
      provider: providerId,
      playlist: null,
      tracks: [],
    })
    vi.spyOn(provider, 'likedTracks').mockResolvedValue({
      provider: providerId,
      loggedIn: true,
      tracks: [songs[providerId]],
      offset: 0,
      limit: 50,
      total: 1,
      hasMore: false,
    })

    await expect(service.getAuthStatus(providerId)).resolves.toEqual(auth)
    await expect(service.getPlaylists({ provider: providerId })).resolves.toMatchObject({
      provider: providerId,
      playlists: [],
    })
    await expect(service.getPlaylistTracks({ provider: providerId, id: 'playlist' })).resolves.toMatchObject({
      provider: providerId,
      tracks: [],
    })
    await expect(
      service.getLikedTracks({ provider: providerId, offset: 0, limit: 50 }),
    ).resolves.toMatchObject({
      provider: providerId,
      tracks: [songs[providerId]],
      total: 1,
    })
  })

  it('normalizes upstream failures without leaking provider payloads', async () => {
    vi.spyOn(service[providerId], 'search').mockRejectedValue(new Error('fixture unavailable'))
    const error = await service
      .search({ provider: providerId, keywords: 'x' })
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(MusicServiceError)
    expect((error as MusicServiceError).message).toBe('PROVIDER_UNAVAILABLE')
    expect((error as MusicServiceError).payload).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      provider: providerId,
      retryable: true,
    })
  })
})

import type {
  LikedTracksRequest,
  LikedTracksResult,
  LyricsRequest,
  LyricDocument,
  MusicAuthResult,
  MusicErrorCode,
  MusicErrorPayload,
  MusicSearchRequest,
  MusicSearchResult,
  PlaybackResolveRequest,
  PlaylistListRequest,
  PlaylistListResult,
  PlaylistTracksRequest,
  PlaylistTracksResult,
} from '@shared/music-contract'
import type { ProviderId } from '@shared/models'
import type { CredentialStore, MainPlaybackResource } from '../types'
import { errorMessage } from '../util/unknown'
import { NeteaseProvider } from '../providers/netease'
import { QQProvider } from '../providers/qq'

export class MusicServiceError extends Error {
  readonly payload: MusicErrorPayload

  constructor(payload: MusicErrorPayload, options?: ErrorOptions) {
    super(payload.code, options)
    this.name = 'MusicServiceError'
    this.payload = payload
  }
}

function providerError(provider: ProviderId, error: unknown): MusicServiceError {
  if (error instanceof MusicServiceError) return error
  return new MusicServiceError(
    {
      code: 'PROVIDER_UNAVAILABLE',
      message: errorMessage(error),
      provider,
      retryable: true,
    },
    { cause: error },
  )
}

function invalidCredential(provider: ProviderId): MusicServiceError {
  return new MusicServiceError({
    code: 'INVALID_CREDENTIALS',
    message: `${provider} login credential is incomplete`,
    provider,
    retryable: false,
  })
}

/**
 * Main-process music orchestration for the two product providers.
 * Provider selection is intentionally centralized here; adding another provider requires changing this switch.
 */
export class MusicService {
  readonly netease: NeteaseProvider
  readonly qq: QQProvider

  constructor(credentials: CredentialStore) {
    this.netease = new NeteaseProvider(credentials)
    this.qq = new QQProvider(credentials)
  }

  private select(provider: ProviderId): NeteaseProvider | QQProvider {
    switch (provider) {
      case 'netease':
        return this.netease
      case 'qq':
        return this.qq
    }
  }

  private async execute<T>(provider: ProviderId, operation: () => Promise<T> | T): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      throw providerError(provider, error)
    }
  }

  async search(request: MusicSearchRequest): Promise<MusicSearchResult> {
    const provider = this.select(request.provider)
    const limit = Math.max(1, Math.min(200, Math.floor(request.limit ?? 30)))
    const songs = await this.execute(request.provider, () => provider.search(request.keywords.trim(), limit))
    return { provider: request.provider, songs }
  }

  /** Returns an upstream resource only to Electron main. Main must replace it with a flux-media handle before IPC. */
  async resolvePlayback(request: PlaybackResolveRequest): Promise<MainPlaybackResource> {
    const provider = this.select(request.song.provider)
    const resolved = await this.execute(request.song.provider, () =>
      provider.resolvePlayback(request.song, request.quality),
    )
    return {
      provider: resolved.provider,
      upstreamUrl: resolved.url,
      upstreamHeaders: resolved.headers,
      trial: resolved.trial,
      playable: resolved.playable,
      level: resolved.level,
      quality: resolved.quality,
      br: resolved.br,
      filename: resolved.filename,
      requestedQuality: resolved.requestedQuality as PlaybackResolveRequest['quality'] | undefined,
      trialInfo: resolved.trialInfo,
      restriction: resolved.restriction,
      reason: resolved.reason,
    }
  }

  async getLyrics(request: LyricsRequest): Promise<LyricDocument> {
    const provider = this.select(request.provider)
    return this.execute(request.provider, () => provider.getLyrics(request.id, request.mid))
  }

  async getAuthStatus(providerId: ProviderId): Promise<MusicAuthResult> {
    const provider = this.select(providerId)
    return this.execute(providerId, () => provider.authStatus())
  }

  async authenticate(providerId: ProviderId, credential: string): Promise<MusicAuthResult> {
    return this.acceptLoginCredential(providerId, credential)
  }
  async acceptLoginCredential(providerId: ProviderId, credential: unknown): Promise<MusicAuthResult> {
    const provider = this.select(providerId)
    if (!provider.acceptCredential(credential)) throw invalidCredential(providerId)
    return this.execute(providerId, () => provider.authStatus())
  }

  async logout(providerId: ProviderId): Promise<void> {
    const provider = this.select(providerId)
    await this.execute(providerId, () => provider.logout())
  }

  async getPlaylists(request: PlaylistListRequest): Promise<PlaylistListResult> {
    const provider = this.select(request.provider)
    const limit = Math.max(1, Math.min(200, Math.floor(request.limit ?? 200)))
    return this.execute(request.provider, () => provider.userPlaylists(limit))
  }

  async getPlaylistTracks(request: PlaylistTracksRequest): Promise<PlaylistTracksResult> {
    const provider = this.select(request.provider)
    return this.execute(request.provider, () => provider.playlistTracks(String(request.id)))
  }

  async getLikedTracks(request: LikedTracksRequest): Promise<LikedTracksResult> {
    const provider = this.select(request.provider)
    const offset = Math.max(0, Math.floor(request.offset ?? 0))
    const limit = Math.max(1, Math.min(200, Math.floor(request.limit ?? 100)))
    const result = await this.execute(request.provider, () => provider.likedTracks(offset, limit))
    return {
      provider: result.provider,
      loggedIn: result.loggedIn,
      identity: result.identity,
      tracks: result.tracks,
      offset: result.offset,
      limit: result.limit,
      total: result.total,
      hasMore: result.hasMore,
    }
  }
}

export function isMusicServiceError(error: unknown): error is MusicServiceError {
  return error instanceof MusicServiceError
}

export function musicErrorCode(error: unknown): MusicErrorCode {
  return error instanceof MusicServiceError ? error.payload.code : 'INTERNAL_ERROR'
}

export function createMusicService(credentials: CredentialStore): MusicService {
  return new MusicService(credentials)
}

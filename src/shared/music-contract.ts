import type {
  LyricDoc,
  PlaybackRestriction,
  ProviderId,
  QualityLevel,
  UnifiedPlaylist,
  UnifiedSong,
} from './models'

export type MusicErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED_RENDERER'
  | 'LOGIN_REQUIRED'
  | 'AUTH_CANCELLED'
  | 'INVALID_CREDENTIALS'
  | 'PROVIDER_UNAVAILABLE'
  | 'UPSTREAM_REJECTED'
  | 'TRACK_UNAVAILABLE'
  | 'LYRICS_UNAVAILABLE'
  | 'PLAYLIST_UNAVAILABLE'
  | 'MEDIA_HANDLE_EXPIRED'
  | 'MEDIA_HOST_BLOCKED'
  | 'INTERNAL_ERROR'

export interface MusicErrorPayload {
  code: MusicErrorCode
  message: string
  provider?: ProviderId
  retryable: boolean
  details?: Record<string, unknown>
}

export interface MusicSearchRequest {
  provider: ProviderId
  keywords: string
  limit?: number
}

export interface MusicSearchResult {
  provider: ProviderId
  songs: UnifiedSong[]
}

export interface PlaybackResolveRequest {
  song: UnifiedSong
  quality: QualityLevel
}

/** The URL is always an opaque flux-media:// URL; upstream URLs and credentials never cross IPC. */
export interface PlaybackResolveResult {
  provider: ProviderId
  url: string | null
  trial: boolean
  playable: boolean
  level?: string
  quality?: string
  br?: number
  filename?: string
  requestedQuality?: QualityLevel
  trialInfo?: unknown
  restriction?: PlaybackRestriction
  reason?: string
}

export interface LyricsRequest {
  provider: ProviderId
  id: number | string
  mid?: string
}

export type LyricDocument = LyricDoc

export interface MusicAuthResult {
  provider: ProviderId
  loggedIn: boolean
  preview?: boolean
  userId?: number | string
  nickname?: string
  avatar?: string
  vipType?: number
  vipLevel?: string
  isVip?: boolean
  isSvip?: boolean
  vipLabel?: string
  hasCookie?: boolean
  pendingProfile?: boolean
  playbackKeyReady?: boolean
  profileSource?: string
  profileUnavailable?: boolean
  partial?: boolean
}

export interface PlaylistListRequest {
  provider: ProviderId
  limit?: number
}

export interface PlaylistListResult {
  provider: ProviderId
  loggedIn: boolean
  identity?: string
  playlists: UnifiedPlaylist[]
}

export interface PlaylistTracksRequest {
  provider: ProviderId
  id: number | string
}

export interface PlaylistTracksResult {
  provider: ProviderId
  loggedIn?: boolean
  playlist: UnifiedPlaylist | null
  tracks: UnifiedSong[]
}

export interface LikedTracksRequest {
  provider: ProviderId
  offset?: number
  limit?: number
}

export interface LikedTracksResult {
  provider: ProviderId
  loggedIn: boolean
  identity?: string
  tracks: UnifiedSong[]
  offset: number
  limit: number
  total: number
  hasMore: boolean
}

export interface FluxMusicApi {
  search(request: MusicSearchRequest): Promise<MusicSearchResult>
  resolvePlayback(request: PlaybackResolveRequest): Promise<PlaybackResolveResult>
  getLyrics(request: LyricsRequest): Promise<LyricDocument>
  getAuthStatus(provider: ProviderId): Promise<MusicAuthResult>
  login(provider: ProviderId): Promise<MusicAuthResult>
  logout(provider: ProviderId): Promise<void>
  getPlaylists(request: PlaylistListRequest): Promise<PlaylistListResult>
  getPlaylistTracks(request: PlaylistTracksRequest): Promise<PlaylistTracksResult>
  getLikedTracks(request: LikedTracksRequest): Promise<LikedTracksResult>
}

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
  /** 1-based 页码，省略即第一页 */
  page?: number
  /** 指定后端：chksz 强制走聚合 API、direct 强制走直连。省略时按密钥配置自动选择。 */
  backend?: 'direct' | 'chksz'
}

export interface MusicSearchResult {
  provider: ProviderId
  songs: UnifiedSong[]
  page: number
  /** 上游是否还有下一页；由"本页是否拿满 limit"推断 */
  hasMore: boolean
}

export interface PlaybackResolveRequest {
  song: UnifiedSong
  quality: QualityLevel
  /** 指定后端：chksz 强制走聚合 API、direct 强制走直连。省略时直连优先，无音源/试听才自动回退 chksz。 */
  backend?: 'direct' | 'chksz'
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
  /** The provider explicitly rejected a credential that existed before this check. */
  credentialInvalidated?: boolean
  preview?: boolean
  userId?: number | string
  nickname?: string
  avatar?: string
  vipType?: number
  vipLevel?: string
  isVip?: boolean
  isSvip?: boolean
  vipLabel?: string
  /** QQ 音乐原始返回的 VIP 等级图标 URL（如 svip6.png） */
  vipIcon?: string
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

export interface DiscoverRequest {
  provider: ProviderId
  limit?: number
}

/** 一个推荐区块（排行榜 / 分类歌单…）。复用 UnifiedPlaylist，点开走 getPlaylistTracks。 */
export interface DiscoverSection {
  id: string
  title: string
  playlists: UnifiedPlaylist[]
}

export interface DiscoverResult {
  provider: ProviderId
  /** false = 该 provider 没有发现页实现，UI 隐藏整块，而不是当成错误 */
  supported: boolean
  /** false = 需要登录才有内容，UI 提示登录而不是显示空白 */
  loggedIn: boolean
  sections: DiscoverSection[]
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
  getDiscover(request: DiscoverRequest): Promise<DiscoverResult>
}

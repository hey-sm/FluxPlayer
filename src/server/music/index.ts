import type {
  DiscoverRequest,
  DiscoverResult,
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
import { ChkszProvider, chkszErrorToast, ChkszApiError } from '../providers/chksz'

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
 * 直连解析结果是否应触发 chksz 回退。
 * - url 为 null（无法播放）→ 回退
 * - trial=true（仅试听片段）→ 回退（chksz 可能拿到完整地址）
 * - 正常可播 → 不回退
 */
function shouldFallbackToChksz(result: { url: string | null; trial: boolean; playable: boolean }): boolean {
  if (!result.playable || !result.url) return true
  if (result.trial) return true
  return false
}

/**
 * Main-process music orchestration for the two product providers + ChKSz aggregation fallback.
 *
 * ChKSz 接入策略（账号直连优先，chksz 仅在直连不可用时兜底）：
 * - search：先走直连搜索；直连失败或无结果 → 用 chksz 搜索
 * - resolvePlayback：先走直连，直连判定无音源 / 仅试听 → 用 chksz 同 id 重解析
 * - getLyrics：先走直连保留 YRC/QRC；直连无歌词或失败 → 用 chksz 的 LRC 兜底
 * - 账号 / 歌单列表 / 我喜欢 / 发现页：永远走直连，不受 chksz 影响
 * - backend=chksz 时强制走 chksz（用户明确要求），失败不回退直连
 */
export class MusicService {
  readonly netease: NeteaseProvider
  readonly qq: QQProvider
  private readonly credentials: CredentialStore

  constructor(credentials: CredentialStore) {
    this.netease = new NeteaseProvider(credentials)
    this.qq = new QQProvider(credentials)
    this.credentials = credentials
  }

  /** 密钥实时读取：配了密钥就可用，无需手动开关。 */
  private get chkszKey(): string {
    return this.credentials.get('chksz')
  }

  private get chksz(): ChkszProvider | null {
    return this.chkszKey ? new ChkszProvider(this.chkszKey) : null
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
    const page = Math.max(1, Math.floor(request.page ?? 1))
    const forceChksz = request.backend === 'chksz'

    // backend=chksz 时强制走 chksz（用户明确要求），失败不回退
    if (forceChksz) {
      const chksz = this.chksz
      if (!chksz) throw providerError(request.provider, new Error('ChKSz 密钥未配置'))
      const songs = await chksz.search(request.provider, request.keywords.trim(), limit, page)
      return { provider: request.provider, songs, page, hasMore: songs.length >= limit }
    }

    // 直连搜索优先（搜索 API 不需要登录，直连永远可用）
    try {
      const songs = await this.execute(request.provider, () =>
        provider.search(request.keywords.trim(), limit, page),
      )
      // 直连有结果 → 直接返回，不消耗 chksz 配额
      if (songs.length > 0) {
        return { provider: request.provider, songs, page, hasMore: songs.length >= limit }
      }
    } catch (error) {
      console.warn('[Search] direct search failed, trying ChKSz:', errorMessage(error))
    }

    // 直连无结果或失败 → 用 chksz 兜底
    const chksz = this.chksz
    if (chksz) {
      try {
        const songs = await chksz.search(request.provider, request.keywords.trim(), limit, page)
        return { provider: request.provider, songs, page, hasMore: songs.length >= limit }
      } catch (error) {
        console.warn('[ChKSz] search fallback also failed:', errorMessage(error))
      }
    }

    // 两者都失败 → 重试直连以获得正确的错误信息
    const songs = await this.execute(request.provider, () =>
      provider.search(request.keywords.trim(), limit, page),
    )
    return { provider: request.provider, songs, page, hasMore: songs.length >= limit }
  }

  /** Returns an upstream resource only to Electron main. Main must replace it with a flux-media handle before IPC. */
  async resolvePlayback(request: PlaybackResolveRequest): Promise<MainPlaybackResource> {
    const forceChksz = request.backend === 'chksz'

    // backend=chksz 时强制走 chksz（用户明确要求），不先试直连
    if (forceChksz) {
      const chksz = this.chksz
      if (!chksz) throw providerError(request.song.provider, new Error('ChKSz 密钥未配置'))
      try {
        const chkszResult = await chksz.resolvePlayback(request.song, request.quality)
        return this.toMainPlaybackResource(chkszResult)
      } catch (error) {
        if (error instanceof ChkszApiError) {
          const toast = chkszErrorToast(error)
          if (toast) {
            throw new Error(`ChKSz ${toast.title}：${toast.message}`, { cause: error })
          }
        }
        throw providerError(request.song.provider, error)
      }
    }

    const provider = this.select(request.song.provider)
    const direct = await this.execute(request.song.provider, () =>
      provider.resolvePlayback(request.song, request.quality),
    )

    // 直连能正常播放 → 直接返回，不消耗 chksz 配额
    if (!shouldFallbackToChksz(direct)) {
      return this.toMainPlaybackResource(direct)
    }

    // 直连无音源 / 仅试听 → 尝试 chksz 同 id 解析
    const chksz = this.chksz
    if (chksz) {
      try {
        const chkszResult = await chksz.resolvePlayback(request.song, request.quality)
        if (chkszResult.url && chkszResult.playable && !chkszResult.trial) {
          return this.toMainPlaybackResource(chkszResult)
        }
        // chksz 也没拿到完整地址，返回直连结果（带原始 restriction 信息）
      } catch (error) {
        // chksz 错误：用户可见的（配额/限流/Key）需向上传，否则播放器看不到原因。
        // 用 ChKSz 前缀文案抛 Error（非 MusicServiceError），跨 IPC 后 renderer 侧
        // musicErrorMessage 识别 ChKSz 前缀并直接显示文案，不走 provider 错误码翻译。
        if (error instanceof ChkszApiError) {
          const toast = chkszErrorToast(error)
          if (toast) {
            throw new Error(`ChKSz ${toast.title}：${toast.message}`, { cause: error })
          }
        }
        // 其它 chksz 错误静默，回退到直连结果
        console.warn('[ChKSz] resolvePlayback failed, using direct result:', errorMessage(error))
      }
    }

    return this.toMainPlaybackResource(direct)
  }

  private toMainPlaybackResource(resolved: {
    provider: string
    url: string | null
    headers: Readonly<Record<string, string>>
    trial: boolean
    playable: boolean
    level?: string
    quality?: string
    br?: number
    filename?: string
    requestedQuality?: string
    trialInfo?: unknown
    restriction?: import('@shared/models').PlaybackRestriction
    reason?: string
    message?: string
    error?: string
    trialDuration?: number
    loggedIn?: boolean
    playbackKeyReady?: boolean
  }): MainPlaybackResource {
    return {
      provider: resolved.provider as ProviderId,
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
    let directDocument: LyricDocument | null = null
    let directError: unknown = null
    try {
      directDocument = await this.execute(request.provider, () => provider.getLyrics(request.id, request.mid))
      // 直连优先：网易云 YRC / QQ QRC 的逐字时间不能被 ChKSZ 的普通 LRC 覆盖。
      if (directDocument.lyric || directDocument.lines.length || directDocument.yrc || directDocument.qrc) {
        return directDocument
      }
    } catch (error) {
      directError = error
      console.warn('[Lyrics] direct provider failed, trying ChKSz:', errorMessage(error))
    }

    // ChKSZ 当前只返回普通 LRC，因此只作为直连无歌词/失败时的兼容兜底。
    const chksz = this.chksz
    if (chksz) {
      try {
        const songLike = {
          provider: request.provider,
          id: request.id,
          mid: request.mid,
        } as import('@shared/models').UnifiedSong
        const doc = await chksz.getLyrics(songLike)
        if (doc.lyric || doc.lines.length) return doc
      } catch (error) {
        console.warn('[ChKSz] lyrics fallback to direct:', errorMessage(error))
      }
    }
    if (directDocument) return directDocument
    throw directError ?? new Error('歌词暂不可用')
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

  async getDiscover(request: DiscoverRequest): Promise<DiscoverResult> {
    const provider = this.select(request.provider)
    const limit = Math.max(1, Math.min(50, Math.floor(request.limit ?? 12)))
    return this.execute(request.provider, () => provider.discover(limit))
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

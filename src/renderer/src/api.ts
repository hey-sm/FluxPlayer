import type {
  FluxMusicApi,
  LikedTracksRequest,
  LikedTracksResult,
  LyricsRequest,
  LyricDocument,
  MusicErrorCode,
  MusicSearchRequest,
  MusicSearchResult,
  PlaylistListRequest,
  PlaylistListResult,
  PlaylistTracksRequest,
  PlaylistTracksResult,
} from '@shared/music-contract'

function getMusicBridge(): FluxMusicApi {
  const bridge = window.fluxDesktop?.music
  if (!bridge) throw new Error('FluxPlayer music bridge is unavailable')
  return bridge
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError')
}

const MUSIC_ERROR_MESSAGES: Readonly<Record<MusicErrorCode, string>> = {
  INVALID_REQUEST: '请求参数无效',
  UNAUTHORIZED_RENDERER: '当前页面无权访问音乐服务',
  LOGIN_REQUIRED: '请先登录服务商账号',
  AUTH_CANCELLED: '已取消登录',
  INVALID_CREDENTIALS: '登录凭据无效',
  PROVIDER_UNAVAILABLE: '音乐服务暂时不可用，请稍后重试',
  UPSTREAM_REJECTED: '服务商拒绝了本次请求',
  TRACK_UNAVAILABLE: '当前歌曲暂不可播放',
  LYRICS_UNAVAILABLE: '歌词暂不可用',
  PLAYLIST_UNAVAILABLE: '歌单暂不可用',
  MEDIA_HANDLE_EXPIRED: '播放链接已过期，请重试',
  MEDIA_HOST_BLOCKED: '媒体来源未获允许',
  INTERNAL_ERROR: '操作失败，请稍后重试',
}

/** Maps the stable IPC error-code union to product copy without exposing provider diagnostics. */
export function musicErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const code = (Object.keys(MUSIC_ERROR_MESSAGES) as MusicErrorCode[]).find((candidate) =>
    raw.includes(candidate),
  )
  return code ? MUSIC_ERROR_MESSAGES[code] : raw || fallback
}

/**
 * IPC cannot abort work that has already reached the main process. This boundary still
 * rejects immediately and suppresses a late result so TanStack Query cannot publish stale data.
 */
export function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(abortError())

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) reject(abortError())
        else resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export const musicClient: FluxMusicApi = {
  search: (request) => getMusicBridge().search(request),
  resolvePlayback: (request) => getMusicBridge().resolvePlayback(request),
  getLyrics: (request) => getMusicBridge().getLyrics(request),
  getAuthStatus: (provider) => getMusicBridge().getAuthStatus(provider),
  login: (provider) => getMusicBridge().login(provider),
  logout: (provider) => getMusicBridge().logout(provider),
  getPlaylists: (request) => getMusicBridge().getPlaylists(request),
  getPlaylistTracks: (request) => getMusicBridge().getPlaylistTracks(request),
  getLikedTracks: (request) => getMusicBridge().getLikedTracks(request),
}

export function searchMusic(request: MusicSearchRequest, signal?: AbortSignal): Promise<MusicSearchResult> {
  return abortable(musicClient.search(request), signal)
}

export function getLyrics(request: LyricsRequest, signal?: AbortSignal): Promise<LyricDocument> {
  return abortable(musicClient.getLyrics(request), signal)
}

export function getPlaylists(
  request: PlaylistListRequest,
  signal?: AbortSignal,
): Promise<PlaylistListResult> {
  return abortable(musicClient.getPlaylists(request), signal)
}

export function getPlaylistTracks(
  request: PlaylistTracksRequest,
  signal?: AbortSignal,
): Promise<PlaylistTracksResult> {
  return abortable(musicClient.getPlaylistTracks(request), signal)
}

export function getLikedTracks(
  request: LikedTracksRequest,
  signal?: AbortSignal,
): Promise<LikedTracksResult> {
  return abortable(musicClient.getLikedTracks(request), signal)
}

export function normalizeCoverSource(value: unknown): string {
  const source = String(value ?? '').trim()
  if (!source || source.startsWith('?') || source.startsWith('#')) return ''
  const normalized = source.startsWith('//') ? `https:${source}` : source
  if (!/^https?:\/\//i.test(normalized)) return ''
  try {
    const url = new URL(normalized)
    if (!url.hostname) return ''
    url.protocol = 'https:'
    return url.href
  } catch {
    return ''
  }
}

export function coverProxyUrl(upstreamUrl: string): string {
  const normalized = normalizeCoverSource(upstreamUrl)
  return normalized ? `flux-media://cover?url=${encodeURIComponent(normalized)}` : ''
}

/**
 * 统一数据模型 —— 描述本地 API 的线格式（wire format）。
 * 字段与旧版 server.js 的响应保持一致：legacy 前端直接消费这些 JSON。
 */

export type ProviderId = 'netease' | 'qq'

export interface UnifiedArtist {
  id?: number | string
  mid?: string
  name: string
}

export interface UnifiedSong {
  provider: ProviderId
  source: ProviderId
  type: string
  id: number | string
  name: string
  artist: string
  artists: UnifiedArtist[]
  artistId?: number | string
  album: string
  cover: string
  duration: number
  fee?: number
  // QQ 专有
  qqId?: number | string
  mid?: string
  songmid?: string
  mediaMid?: string
  artistMid?: string
  albumMid?: string
  playable?: boolean
}

export interface UnifiedPlaylist {
  provider?: ProviderId
  source?: ProviderId
  type?: string
  id: number | string
  name: string
  cover: string
  trackCount: number
  playCount?: number
  creator?: string
  subscribed?: boolean
  specialType?: number
  tag?: string
}

export type RestrictionCategory =
  | 'login_required'
  | 'trial_only'
  | 'vip_required'
  | 'paid_required'
  | 'copyright_unavailable'
  | 'url_unavailable'

export interface PlaybackRestriction {
  provider: ProviderId
  category: RestrictionCategory
  action: string
  message: string
  [key: string]: unknown
}

export interface SongUrlResult {
  provider?: ProviderId
  url: string | null
  trial: boolean
  playable: boolean
  level?: string
  quality?: string
  br?: number
  filename?: string
  requestedQuality?: string
  trialInfo?: unknown
  restriction?: PlaybackRestriction
  reason?: string
  message?: string
  error?: string
  [key: string]: unknown
}

export interface LyricLine {
  time: number
  text: string
  ttext?: string
}

export interface LyricDoc {
  provider?: ProviderId
  id?: number | string
  mid?: string
  /** 兼容 legacy API 的原始字段；M3 期间不得删除或改名。 */
  lyric: string
  tlyric: string
  yrc: string
  /** 已解析并按时间排序、合并翻译的歌词行。 */
  lines: LyricLine[]
  qrc?: string
  roma?: string
  source: string
  error?: string
}

export interface NeteaseLoginInfo {
  loggedIn: boolean
  userId?: number | string
  nickname?: string
  avatar?: string
  vipType: number
  vipLevel: string
  isVip: boolean
  isSvip: boolean
  vipLabel: string
  hasCookie?: boolean
  pendingProfile?: boolean
  [key: string]: unknown
}

export interface QQLoginInfo {
  provider: 'qq'
  loggedIn: boolean
  preview?: boolean
  userId?: string
  nickname?: string
  avatar?: string
  vipType?: number
  hasCookie?: boolean
  playbackKeyReady?: boolean
  profileSource?: string
  profileUnavailable?: boolean
  [key: string]: unknown
}

export const NETEASE_QUALITY_CANDIDATES = [
  { level: 'jymaster', br: 1999000, label: '超清母带', svip: true },
  { level: 'hires', br: 1999000, label: '高清臻音' },
  { level: 'lossless', br: 1411000, label: '无损' },
  { level: 'exhigh', br: 999000, label: '极高' },
  { level: 'standard', br: 128000, label: '标准' },
] as const

export const QQ_QUALITY_CANDIDATE_TEMPLATES = [
  { prefix: 'RS01', ext: '.flac', level: 'hires', label: 'Hi-Res FLAC' },
  { prefix: 'F000', ext: '.flac', level: 'lossless', label: '无损 FLAC' },
  { prefix: 'M800', ext: '.mp3', level: 'exhigh', label: '320k MP3' },
  { prefix: 'M500', ext: '.mp3', level: 'standard', label: '128k MP3' },
  { prefix: 'C400', ext: '.m4a', level: 'aac', label: 'AAC/M4A' },
] as const

export type QualityLevel = 'jymaster' | 'hires' | 'lossless' | 'exhigh' | 'standard'

export function normalizeQualityPreference(value: unknown): QualityLevel {
  const raw = String(value || '')
    .toLowerCase()
    .trim()
  if (['jymaster', 'master', 'studio', 'svip'].includes(raw)) return 'jymaster'
  if (['hires', 'hi-res', 'highres', 'zhenyin', 'spatial'].includes(raw)) return 'hires'
  if (['lossless', 'flac', 'sq'].includes(raw)) return 'lossless'
  if (['exhigh', 'high', '320', '320k', 'hq'].includes(raw)) return 'exhigh'
  if (['standard', 'normal', '128', '128k', 'std'].includes(raw)) return 'standard'
  return 'hires'
}

export function qualityCandidatesFrom<T extends { level: string }>(target: string, candidates: readonly T[]): T[] {
  const normalized = normalizeQualityPreference(target)
  let start = candidates.findIndex((item) => item.level === normalized)
  if (start < 0) start = 0
  return candidates.slice(start) as T[]
}

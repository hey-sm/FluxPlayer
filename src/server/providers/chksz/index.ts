/**
 * ChKSz 聚合 API provider。
 *
 * 只实现 resolvePlayback / getLyrics / search 三件事，作为直连（netease/qq）的
 * 透明解锁层：直连判定的无音源歌曲，用同一个平台 id 交给 chksz 重新解析。
 * 不实现账号 / 歌单列表 / 我喜欢 / 发现页 —— 这些仍走直连。
 */
import type { LyricDoc, ProviderId, QualityLevel, UnifiedSong } from '@shared/models'
import { buildLyricLines } from '@shared/lyrics'
import type { UpstreamPlaybackResource } from '../../types'
import { asArray, asRecord, at, field, numberValue, optionalString, stringValue } from '../../util/unknown'
import { chkszRequest, ChkszApiError, type ChkszErrorCode } from './client'

/** chksz 返回的播放直链 CDN 域名（与直连上游基本一致）。 */
export const CHKSZ_AUDIO_HOSTS = new Set<string>([
  'm801.music.126.net',
  'm701.music.126.net',
  'm704.music.126.net',
  'music.126.net',
  'm801.music.127.net',
  'dl.stream.qqmusic.qq.com',
  'ws.stream.qqmusic.qq.com',
  'isure.stream.qqmusic.qq.com',
  'streamoc.music.qq.com',
])

export class ChkszProvider {
  readonly id = 'chksz' as const

  constructor(private readonly apikey: string) {}

  get available(): boolean {
    return Boolean(this.apikey)
  }

  /** 网易云音质 → chksz level 参数（chksz 支持 sky/jyeffect 两档额外，归入 jymaster）。 */
  private neteaseLevel(quality: QualityLevel): string {
    switch (quality) {
      case 'standard':
        return 'standard'
      case 'exhigh':
        return 'exhigh'
      case 'lossless':
        return 'lossless'
      case 'hires':
        return 'hires'
      case 'jymaster':
        return 'jymaster'
    }
  }

  /** QQ/酷狗音质 → chksz size 参数（直传，服务端不做降级映射）。 */
  private qqSize(quality: QualityLevel): string {
    switch (quality) {
      case 'standard':
        return '128k'
      case 'exhigh':
        return '320k'
      case 'lossless':
        return 'flac'
      case 'hires':
        return 'hires'
      case 'jymaster':
        return 'master'
    }
  }

  /**
   * 用网易云歌曲 id 解析播放地址。
   * 返回 chksz 163_music 的直链，或抛 ChkszApiError。
   */
  async resolveNetease(
    id: string,
    quality: QualityLevel,
    options: { signal?: AbortSignal } = {},
  ): Promise<UpstreamPlaybackResource> {
    const level = this.neteaseLevel(quality)
    const json = await chkszRequest(
      '/api/163_music',
      this.apikey,
      { id: String(id), level, type: 'json' },
      { signal: options.signal },
    )
    const data = asRecord(at(json, 'data') ?? field(json, 'data'))
    const url = optionalString(field(data, 'url'))
    if (!url) {
      return {
        provider: 'netease',
        url: null,
        headers: {},
        trial: false,
        playable: false,
        requestedQuality: quality,
        reason: 'CHKSZ_NO_URL',
        message: optionalString(field(json, 'msg')) || 'ChKSz 未返回播放地址',
      }
    }
    const br = numberValue(field(data, 'br')) || undefined
    return {
      provider: 'netease',
      url,
      headers: {},
      trial: false,
      playable: true,
      level: stringValue(field(data, 'level')) || level,
      quality: stringValue(field(data, 'level')) || level,
      br,
      filename: undefined,
      requestedQuality: quality,
    }
  }

  /**
   * 用 QQ 歌曲 mid 解析播放地址。
   * chksz qq_music 是两段式：先按 mid 直接解析（无需先搜索）。
   */
  async resolveQQ(
    mid: string,
    quality: QualityLevel,
    options: { signal?: AbortSignal } = {},
  ): Promise<UpstreamPlaybackResource> {
    const size = this.qqSize(quality)
    const json = await chkszRequest(
      '/api/qq_music',
      this.apikey,
      { mid: String(mid), size, type: 'json' },
      { signal: options.signal },
    )
    const url = optionalString(field(json, 'url'))
    if (!url) {
      return {
        provider: 'qq',
        url: null,
        headers: {},
        trial: false,
        playable: false,
        requestedQuality: quality,
        reason: 'CHKSZ_NO_URL',
        message: optionalString(field(json, 'msg')) || 'ChKSz 未返回播放地址',
      }
    }
    const bitrate = stringValue(field(json, 'bitrate')) || size
    return {
      provider: 'qq',
      url,
      headers: {},
      trial: false,
      playable: true,
      level: bitrate,
      quality: bitrate,
      filename: undefined,
      requestedQuality: quality,
    }
  }

  /** 统一入口：按 song 的 provider 和 id/mid 分发到对应解析路径。 */
  async resolvePlayback(
    song: UnifiedSong,
    quality: QualityLevel,
    options: { signal?: AbortSignal } = {},
  ): Promise<UpstreamPlaybackResource> {
    if (song.provider === 'netease') return this.resolveNetease(String(song.id), quality, options)
    if (song.provider === 'qq') {
      const mid = song.mid || song.songmid || String(song.id)
      if (!mid) {
        return {
          provider: 'qq',
          url: null,
          headers: {},
          trial: false,
          playable: false,
          requestedQuality: quality,
          reason: 'MISSING_MID',
          message: 'QQ 歌曲 mid 缺失，无法通过 ChKSz 解析',
        }
      }
      return this.resolveQQ(mid, quality)
    }
    // 未支持的 provider（kugou 暂未在 song.provider 里出现）
    return {
      provider: song.provider,
      url: null,
      headers: {},
      trial: false,
      playable: false,
      requestedQuality: quality,
      reason: 'CHKSZ_UNSUPPORTED_PROVIDER',
      message: 'ChKSz 暂不支持该音源',
    }
  }

  /** 网易云歌词。 */
  async getNeteaseLyrics(id: string): Promise<LyricDoc> {
    const json = await chkszRequest('/api/163_lyric', this.apikey, { id: String(id) })
    const data = asRecord(at(json, 'data') ?? field(json, 'data'))
    const lyric = stringValue(at(data, 'lrc') ?? field(data, 'lrc'))
    const tlyric = stringValue(at(data, 'tlyric') ?? field(data, 'tlyric'))
    const roma = stringValue(at(data, 'romalrc') ?? field(data, 'romalrc'))
    return {
      provider: 'netease',
      lyric,
      tlyric,
      yrc: '',
      roma,
      lines: buildLyricLines({ lyric, tlyric, yrc: '' }),
      source: 'chksz',
    }
  }

  /** QQ 歌词：qq_music?mid= 解析响应内嵌 lrc 字段。 */
  async getQQLyrics(mid: string): Promise<LyricDoc> {
    const json = await chkszRequest('/api/qq_music', this.apikey, { mid, type: 'json' })
    const lyric = stringValue(field(json, 'lrc'))
    const tlyric = ''
    const roma = ''
    return {
      provider: 'qq',
      lyric,
      tlyric,
      yrc: '',
      roma,
      lines: buildLyricLines({ lyric, tlyric, yrc: '' }),
      source: 'chksz',
    }
  }

  async getLyrics(song: UnifiedSong): Promise<LyricDoc> {
    if (song.provider === 'netease') return this.getNeteaseLyrics(String(song.id))
    if (song.provider === 'qq') return this.getQQLyrics(song.mid || song.songmid || String(song.id))
    return {
      provider: song.provider,
      lyric: '',
      tlyric: '',
      yrc: '',
      lines: [],
      source: 'chksz',
      error: 'unsupported',
    }
  }

  /**
   * 搜索（网易云）。chksz 搜索结果不含 playable 字段，默认视为可播放。
   * QQ 搜索字段稀疏（无封面/时长），只在换源面板场景使用。
   */
  async search(provider: ProviderId, keywords: string, limit: number, page = 1): Promise<UnifiedSong[]> {
    const offset = Math.max(0, (Math.max(1, Math.floor(page)) - 1) * limit)
    if (provider === 'netease') {
      const json = await chkszRequest('/api/163_search', this.apikey, {
        keyword: keywords,
        limit,
        offset,
      })
      // data 可能是数组 [{...}], 也可能嵌套在 data.songs / data.result 里
      const rawData = at(json, 'data') ?? field(json, 'data')
      let items: unknown[]
      if (Array.isArray(rawData)) {
        items = rawData
      } else {
        // data 是对象 → 取 data.songs / data.result.songs / data.list
        const inner = asRecord(rawData)
        const nested = inner.songs ?? inner.result ?? inner.list ?? inner
        items = asArray(nested)
      }
      return items
        .map((raw): UnifiedSong => {
          const item = asRecord(raw)
          const id = numberValue(field(item, 'id')) || stringValue(field(item, 'id')) || ''
          const artistStr = stringValue(
            field(item, 'artists') ?? field(item, 'artist') ?? field(item, 'singer'),
          )
          return {
            provider: 'netease',
            type: 'song',
            id,
            name: stringValue(field(item, 'name')),
            artist: artistStr,
            artists: artistStr
              ? artistStr
                  .split(/[/&,，]+/)
                  .map((name) => ({ name: name.trim() }))
                  .filter((a) => a.name)
              : [],
            album: stringValue(field(item, 'album')),
            cover: stringValue(field(item, 'picUrl') ?? field(item, 'pic')),
            duration: numberValue(field(item, 'duration')) || 0,
            playable: true,
          }
        })
        .filter((s) => s.id !== '' && s.name)
    }
    if (provider === 'qq') {
      const json = await chkszRequest('/api/qq_music', this.apikey, {
        msg: keywords,
        num: Math.min(50, Math.max(1, limit)),
      })
      const items = asArray(field(json, 'list'))
      return items
        .map((raw): UnifiedSong => {
          const item = asRecord(raw)
          const mid = stringValue(field(item, 'mid'))
          return {
            provider: 'qq',
            type: 'song',
            id: mid || numberValue(field(item, 'n')) || '',
            name: stringValue(field(item, 'name')),
            artist: stringValue(field(item, 'singer')),
            artists: stringValue(field(item, 'singer'))
              .split(/[/&,，]+/)
              .map((name) => ({ name: name.trim() }))
              .filter((a) => a.name),
            album: stringValue(field(item, 'album')),
            cover: '',
            duration: 0,
            mid,
            playable: true,
          }
        })
        .filter((s) => s.name && (s.mid || s.id !== ''))
    }
    return []
  }
}

/** 判断 chksz 错误是否应让上层提示用户（配额/限流/Key 失效）。 */
export function isChkszUserFacingError(error: unknown): error is ChkszApiError {
  if (!(error instanceof ChkszApiError)) return false
  const userFacing: ChkszErrorCode[] = [
    'CHKSZ_QUOTA_EXHAUSTED',
    'CHKSZ_RATE_LIMITED',
    'CHKSZ_UNAUTHORIZED',
    'CHKSZ_FORBIDDEN',
  ]
  return userFacing.includes(error.code)
}

/** 把 chksz 错误转成可显示的中文文案。 */
export function chkszErrorToast(error: unknown): { title: string; message: string } | null {
  if (!isChkszUserFacingError(error)) return null
  const upstream = error.upstreamMessage
  switch (error.code) {
    case 'CHKSZ_QUOTA_EXHAUSTED':
      return {
        title: 'ChKSz 额度已用尽',
        message: upstream || 'ChKSz 免费额度已用完，可等待次日刷新或兑换额度',
      }
    case 'CHKSZ_RATE_LIMITED':
      return { title: 'ChKSz 请求过于频繁', message: upstream || '已触发 ChKSz 限流，请稍后再试' }
    case 'CHKSZ_UNAUTHORIZED':
      return { title: 'ChKSz 密钥无效', message: upstream || 'ChKSz API Key 无效或已失效，请检查设置' }
    case 'CHKSZ_FORBIDDEN':
      return { title: 'ChKSz 访问被拒', message: upstream || 'ChKSz 已拒绝该请求，请稍后重试' }
    default:
      return null
  }
}

export { ChkszApiError }
export type { ChkszErrorCode }

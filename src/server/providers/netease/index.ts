import type { CredentialStore } from '../../types'
import type {
  LyricDoc,
  NeteaseLoginInfo,
  PlaybackRestriction,
  SongUrlResult,
  UnifiedSong,
} from '@shared/models'
import { NETEASE_QUALITY_CANDIDATES, normalizeQualityPreference, qualityCandidatesFrom } from '@shared/models'
import { buildLyricLines } from '@shared/lyrics'
import { normalizeCookieHeader, rawCookieFallback } from '../../util/cookies'
import { ncm, type NcmResponse } from './sdk'

const EMPTY_LOGIN: NeteaseLoginInfo = {
  loggedIn: false,
  vipType: 0,
  vipLevel: 'none',
  isVip: false,
  isSvip: false,
  vipLabel: '无VIP',
}

function playbackRestriction(
  category: PlaybackRestriction['category'],
  message: string,
  action: string,
  extra?: Record<string, unknown>,
): PlaybackRestriction {
  return { provider: 'netease', category, action, message, ...(extra || {}) }
}

export function classifyNeteasePlaybackRestriction(lastData: any, loginInfo: any): PlaybackRestriction {
  const loggedIn = !!(loginInfo && loginInfo.loggedIn)
  const fee = Number(lastData && lastData.fee)
  const code = Number(lastData && lastData.code)
  const freeTrial = lastData && lastData.freeTrialInfo
  if (!loggedIn) {
    return playbackRestriction('login_required', '网易云需要登录后尝试获取完整播放地址', 'login', { code, fee })
  }
  if (freeTrial) {
    return playbackRestriction('trial_only', '网易云仅返回试听片段，完整播放需要会员或购买', 'upgrade', { code, fee })
  }
  if (fee === 1) {
    return playbackRestriction('vip_required', '网易云歌曲需要 VIP 权限，当前无法获取完整播放地址', 'upgrade', { code, fee })
  }
  if (fee === 4 || fee === 8) {
    return playbackRestriction('paid_required', '网易云歌曲需要单曲、专辑购买或更高权限', 'purchase', { code, fee })
  }
  if (code === 404 || code === 403) {
    return playbackRestriction('copyright_unavailable', '网易云版权暂不可播，换源或稍后重试会更稳', 'switch_source', { code, fee })
  }
  return playbackRestriction(
    'url_unavailable',
    '网易云没有返回可播放地址，可能是版权、会员或地区限制',
    loggedIn ? 'switch_source' : 'login',
    { code, fee },
  )
}

export function mapArtists(raw: any): Array<{ id?: number; name: string }> {
  return ((raw || []) as any[])
    .map((a) => ({ id: a && a.id, name: (a && a.name) || '' }))
    .filter((a) => a.name)
}

export function mapSongRecord(s: any): UnifiedSong {
  s = s || {}
  const artists = mapArtists(s.ar || s.artists)
  const album = s.al || s.album || {}
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: s.id,
    name: s.name,
    artist: artists.map((a) => a.name).join(' / '),
    artists,
    artistId: artists[0] && artists[0].id,
    album: album.name || '',
    cover: album.picUrl || album.coverUrl || '',
    duration: s.dt || s.duration || 0,
    fee: s.fee,
  }
}

export function readCookieFromResponse(resp: any): string {
  const candidates = [
    resp && resp.cookie,
    resp && resp.body && resp.body.cookie,
    resp && resp.body && resp.body.data && resp.body.data.cookie,
    resp && resp.body && resp.body.data && resp.body.data.cookies,
  ]
  for (const candidate of candidates) {
    const cookie = normalizeCookieHeader(candidate)
    if (cookie) return cookie
  }
  return ''
}

function normalizeApiCode(payload: any): number {
  const body = payload && (payload.body || payload)
  return Number((body && body.code) || (body && body.body && body.body.code) || (payload && payload.status) || 0)
}

function normalizeApiMessage(payload: any): string {
  const body = payload && (payload.body || payload)
  return (
    (body && (body.message || body.msg || body.error)) ||
    (body && body.body && (body.body.message || body.body.msg || body.body.error)) ||
    ''
  )
}

/**
 * VIP 归一化（相对旧版 normalizeNeteaseVip 的简化实现）：
 * 只依赖 profile/account 上的 vipType 数字。vipType>=10 视为 SVIP。
 * 旧版会深扫 redVipLevel 等嵌套结构，此处若发现档位识别不准再回补。
 */
function normalizeVip(profile: any, account: any, extra: any) {
  const vipType =
    Number(
      (profile && profile.vipType) ??
        (account && account.vipType) ??
        (extra && extra.vipType) ??
        0,
    ) || 0
  const isSvip = vipType >= 10
  const isVip = vipType > 0
  return {
    vipType,
    vipLevel: isSvip ? 'svip' : isVip ? 'vip' : 'none',
    isVip,
    isSvip,
    vipLabel: isSvip ? 'SVIP' : isVip ? 'VIP' : '无VIP',
  }
}

export function normalizeLoginInfo(profile: any, account: any, extra?: any): NeteaseLoginInfo {
  profile = profile || {}
  account = account || {}
  const userId = profile.userId || profile.user_id || profile.id || account.userId || account.id || ''
  if (!(userId || userId === 0)) return { ...EMPTY_LOGIN }
  return {
    loggedIn: true,
    userId,
    nickname: profile.nickname || profile.userName || '网易云用户',
    avatar: profile.avatarUrl || profile.avatar || '',
    ...normalizeVip(profile, account, extra),
  }
}

function isAuthInvalidPayload(payload: any): boolean {
  const code = normalizeApiCode(payload)
  if (code === 301 || code === 401) return true
  const msg = normalizeApiMessage(payload)
  return /未登录|需要登录|请先登录|login/i.test(msg) && code >= 300
}

export class NeteaseProvider {
  readonly id = 'netease' as const

  constructor(private readonly credentials: CredentialStore) {}

  get cookie(): string {
    return this.credentials.get('netease')
  }

  saveCookie(raw: unknown): void {
    this.credentials.set('netease', normalizeCookieHeader(raw) || rawCookieFallback(raw))
  }

  hasSvip(info: NeteaseLoginInfo): boolean {
    return !!(info && info.loggedIn && (info.vipLevel === 'svip' || info.isSvip || Number(info.vipType || 0) >= 10))
  }

  async loginInfo(): Promise<NeteaseLoginInfo> {
    const cookie = this.cookie
    if (!cookie) return { ...EMPTY_LOGIN }

    try {
      const st = await ncm.login_status({ cookie, timestamp: Date.now() })
      const body = st.body || {}
      const data = body.data || body
      const info = normalizeLoginInfo(data.profile || body.profile, data.account || body.account, data)
      if (info.loggedIn) return info
    } catch (e: any) {
      console.warn('[Login] login_status failed:', e.message)
    }

    try {
      const acc = await ncm.user_account({ cookie, timestamp: Date.now() })
      const body = acc.body || {}
      const info = normalizeLoginInfo(body.profile, body.account, body)
      if (info.loggedIn) return info
      if (isAuthInvalidPayload(acc)) this.saveCookie('')
      return { ...EMPTY_LOGIN, hasCookie: !!this.cookie }
    } catch (e: any) {
      console.warn('[Login] account check failed:', e.message)
      return { ...EMPTY_LOGIN, hasCookie: !!this.cookie }
    }
  }

  async search(keywords: string, limit: number): Promise<UnifiedSong[]> {
    const result = await ncm.cloudsearch({ keywords, limit, cookie: this.cookie })
    const songs = (result.body && result.body.result && result.body.result.songs) || []
    let mapped = songs.map(mapSongRecord)

    const missing = mapped.filter((s: UnifiedSong) => !s.cover).map((s: UnifiedSong) => s.id)
    if (missing.length) {
      try {
        const dd = await ncm.song_detail({ ids: missing.join(','), cookie: this.cookie })
        const songsArr = (dd.body && dd.body.songs) || []
        const idToPic: Record<string, string> = {}
        songsArr.forEach((s: any) => {
          const pic = (s.al && s.al.picUrl) || (s.album && s.album.picUrl) || ''
          if (pic) idToPic[s.id] = pic
        })
        mapped = mapped.map((s: UnifiedSong) => (s.cover ? s : { ...s, cover: idToPic[String(s.id)] || '' }))
      } catch (e: any) {
        console.warn('[Search] backfill failed:', e.message)
      }
    }
    return mapped
  }

  async songUrl(id: string, loginInfo: NeteaseLoginInfo, qualityPreference: string): Promise<SongUrlResult> {
    const cookie = this.cookie
    const requestedQuality = normalizeQualityPreference(qualityPreference)
    const svipReady = this.hasSvip(loginInfo)
    const qualities = qualityCandidatesFrom(requestedQuality, NETEASE_QUALITY_CANDIDATES).filter(
      (q: any) => !q.svip || svipReady,
    )

    let trialFallback: SongUrlResult | null = null
    let lastData: any = null
    let lastError: any = null

    for (const q of qualities) {
      try {
        let result: NcmResponse
        try {
          if (typeof ncm.song_url_v1 !== 'function') throw new Error('song_url_v1 unavailable')
          result = await ncm.song_url_v1({ id, level: q.level, cookie })
        } catch {
          result = await ncm.song_url({ id, br: (q as any).br, cookie })
        }
        const d = result.body && result.body.data && result.body.data[0]
        if (d) lastData = d
        const url = d && d.url
        const freeTrial = d && d.freeTrialInfo
        if (url && !freeTrial) {
          return { url, trial: false, playable: true, level: q.level, quality: (q as any).label, br: d.br, requestedQuality }
        }
        if (url && freeTrial && !trialFallback) {
          trialFallback = {
            url,
            trial: true,
            playable: true,
            level: q.level,
            quality: (q as any).label,
            br: d.br,
            requestedQuality,
            trialDuration: 30,
            trialInfo: { start: 0, end: 30, duration: 30, source: 'netease-free-trial' },
            restriction: { ...classifyNeteasePlaybackRestriction(d, loginInfo), duration: 30 },
          }
        }
      } catch (err: any) {
        lastError = err
      }
    }
    if (trialFallback) return trialFallback
    const restriction = classifyNeteasePlaybackRestriction(lastData, loginInfo)
    // 与 QQ 侧对称的取链失败诊断出口
    console.warn('[SongUrl] no url', {
      id,
      requestedQuality,
      lastCode: lastData && lastData.code,
      fee: lastData && lastData.fee,
      category: restriction.category,
      error: lastError && lastError.message,
    })
    return {
      url: null,
      trial: false,
      playable: false,
      reason: restriction.category,
      message: restriction.message,
      restriction,
      lastCode: lastData && lastData.code,
      fee: lastData && lastData.fee,
      error: lastError && lastError.message,
      requestedQuality,
    }
  }

  async lyric(id: string): Promise<LyricDoc> {
    let body: any = {}
    let source = 'lyric'
    try {
      if (typeof ncm.lyric_new === 'function') {
        const nr = await ncm.lyric_new({ id, cookie: this.cookie, timestamp: Date.now() })
        body = nr.body || {}
        source = 'lyric_new'
      }
    } catch (errNew: any) {
      console.warn('[LyricNew]', errNew.message)
    }
    if (!((body.lrc && body.lrc.lyric) || (body.yrc && body.yrc.lyric))) {
      const r = await ncm.lyric({ id, cookie: this.cookie, timestamp: Date.now() })
      body = r.body || body || {}
      source = 'lyric'
    }
    const lyric = (body.lrc && body.lrc.lyric) || ''
    const tlyric = (body.tlyric && body.tlyric.lyric) || ''
    const yrc = (body.yrc && body.yrc.lyric) || ''
    return {
      lyric,
      tlyric,
      yrc,
      lines: buildLyricLines({ lyric, tlyric, yrc }),
      source,
    }
  }

  async userPlaylists(limit: number): Promise<any> {
    const info = await this.loginInfo()
    if (!info.loggedIn || !info.userId) return { loggedIn: false, playlists: [] }
    const r = await ncm.user_playlist({ uid: info.userId, limit, cookie: this.cookie, timestamp: Date.now() })
    const list = ((r.body && r.body.playlist) || []).map((pl: any) => ({
      id: pl.id,
      name: pl.name,
      cover: pl.coverImgUrl || '',
      trackCount: pl.trackCount || 0,
      playCount: pl.playCount || 0,
      creator: (pl.creator && pl.creator.nickname) || '',
      subscribed: !!pl.subscribed,
      specialType: pl.specialType || 0,
    }))
    return { loggedIn: true, userId: info.userId, playlists: list }
  }

  async likedTracks(offset: number, limit: number): Promise<any> {
    const info = await this.loginInfo()
    if (!info.loggedIn || !info.userId) {
      return {
        provider: 'netease',
        loggedIn: false,
        error: 'LOGIN_REQUIRED',
        message: '登录网易云账号后才能读取喜欢的音乐',
        tracks: [],
      }
    }

    const safeOffset = Math.max(0, Math.floor(offset || 0))
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit || 100)))
    const liked = await ncm.likelist({ uid: info.userId, cookie: this.cookie, timestamp: Date.now() })
    const ids = Array.from(
      new Set(
        (((liked.body && liked.body.ids) || []) as unknown[])
          .map((id) => String(id || '').trim())
          .filter(Boolean),
      ),
    )
    const pageIds = ids.slice(safeOffset, safeOffset + safeLimit)
    const rawTracks: any[] = []

    for (let start = 0; start < pageIds.length; start += 100) {
      const chunk = pageIds.slice(start, start + 100)
      const detail = await ncm.song_detail({ ids: chunk.join(','), cookie: this.cookie, timestamp: Date.now() })
      rawTracks.push(...(((detail.body && detail.body.songs) || []) as any[]))
    }

    const byId = new Map(
      rawTracks
        .map(mapSongRecord)
        .filter((track: UnifiedSong) => track.id !== undefined && track.id !== null && track.name)
        .map((track: UnifiedSong) => [String(track.id), track] as const),
    )
    const tracks = pageIds
      .map((id) => byId.get(id))
      .filter((track): track is UnifiedSong => track !== undefined)

    return {
      provider: 'netease',
      loggedIn: true,
      userId: info.userId,
      offset: safeOffset,
      limit: safeLimit,
      total: ids.length,
      hasMore: safeOffset + pageIds.length < ids.length,
      tracks,
    }
  }

  async playlistTracks(id: string): Promise<any> {
    let playlistMeta: any = { id, name: '', cover: '', trackCount: 0 }
    let rawTracks: any[] = []

    if (typeof ncm.playlist_track_all === 'function') {
      try {
        const all = await ncm.playlist_track_all({ id, limit: 500, offset: 0, cookie: this.cookie, timestamp: Date.now() })
        rawTracks = (all.body && (all.body.songs || all.body.tracks)) || []
      } catch (err: any) {
        console.warn('[PlaylistTracks] playlist_track_all failed, fallback to detail:', err.message)
      }
    }

    if (!rawTracks.length && typeof ncm.playlist_detail === 'function') {
      const detail = await ncm.playlist_detail({ id, s: 0, cookie: this.cookie, timestamp: Date.now() })
      const pl = (detail.body && detail.body.playlist) || {}
      playlistMeta = { id: pl.id || id, name: pl.name || '', cover: pl.coverImgUrl || '', trackCount: pl.trackCount || 0 }
      rawTracks = pl.tracks || []
    }

    const tracks = rawTracks.map(mapSongRecord).filter((t: UnifiedSong) => t.id)
    if (!playlistMeta.trackCount) playlistMeta.trackCount = tracks.length
    return { playlist: playlistMeta, tracks }
  }

  async logout(): Promise<void> {
    try {
      await ncm.logout({ cookie: this.cookie })
    } catch {
      /* ignore */
    }
    this.saveCookie('')
  }
}

import type { CredentialStore } from '../../types'
import type {
  LyricDoc,
  NeteaseLoginInfo,
  PlaybackRestriction,
  SongUrlResult,
  UnifiedPlaylist,
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

export function mapDiscoverPlaylist(pl: any, tag?: string): UnifiedPlaylist {
  pl = pl || {}
  const creator = pl.creator || pl.user || {}
  const id = pl.id || pl.resourceId || pl.creativeId
  return {
    provider: 'netease',
    source: 'netease',
    type: 'playlist',
    id,
    name: pl.name || pl.title || '',
    cover:
      pl.picUrl ||
      pl.coverImgUrl ||
      pl.coverUrl ||
      (pl.uiElement && pl.uiElement.image && pl.uiElement.image.imageUrl) ||
      '',
    trackCount: pl.trackCount || pl.songCount || pl.programCount || 0,
    playCount: pl.playCount || pl.playcount || 0,
    creator: creator.nickname || creator.name || '',
    tag: tag || pl.alg || '',
  }
}

function mapPodcastRadioLite(r: any): any {
  r = r || {}
  const dj = r.dj || r.djSimple || r.djUser || r.creator || {}
  return {
    provider: 'netease',
    source: 'netease',
    type: 'podcast',
    id: r.id || r.rid || r.radioId,
    name: r.name || r.radioName || '',
    cover: r.picUrl || r.coverUrl || r.cover || '',
    djName: dj.nickname || dj.name || '',
    programCount: r.programCount || r.programsCount || 0,
    subCount: r.subCount || 0,
    desc: r.desc || r.description || '',
  }
}

function isLowSignalPodcastItem(item: any): boolean {
  const low = (v: any) => String(v || '').trim().toLowerCase()
  const name = low(item && (item.name || item.title || item.radioName))
  const sub = low(item && (item.djName || item.category || item.desc || item.sub))
  return /购买播客|付费精品|qzone|空间背景音乐|背景音乐/i.test(name + ' ' + sub)
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

  async discoverHome(): Promise<any> {
    const info = await this.loginInfo()
    const loggedIn = !!(info && info.loggedIn)
    if (!loggedIn) {
      return {
        loggedIn: false,
        user: null,
        dailySongs: [],
        playlists: [],
        podcasts: [],
        mode: 'starter',
        updatedAt: Date.now(),
      }
    }
    const cookie = this.cookie
    const results = await Promise.allSettled([
      ncm.personalized({ limit: 8, cookie, timestamp: Date.now() }),
      ncm.dj_hot({ limit: 6, offset: 0, cookie, timestamp: Date.now() }),
      ncm.recommend_resource({ cookie, timestamp: Date.now() }),
      ncm.recommend_songs({ cookie, timestamp: Date.now() }),
    ])

    const bodyOf = (r: PromiseSettledResult<NcmResponse>) =>
      (r.status === 'fulfilled' && r.value && r.value.body) || {}

    const personalizedBody = bodyOf(results[0])
    const publicPlaylists = ((personalizedBody.result || personalizedBody.data || []) as any[])
      .map((pl) => mapDiscoverPlaylist(pl, '推荐歌单'))
      .filter((pl) => pl.id && pl.name)
      .slice(0, 8)

    const podcastBody = bodyOf(results[1])
    const podcastRaw = podcastBody.djRadios || podcastBody.djradios || podcastBody.radios || podcastBody.data || []
    const podcasts = (Array.isArray(podcastRaw) ? podcastRaw : [])
      .map(mapPodcastRadioLite)
      .filter((p: any) => p.id && !isLowSignalPodcastItem(p))
      .slice(0, 6)

    const recommendBody = bodyOf(results[2])
    const privateRaw = recommendBody.recommend || recommendBody.data || []
    const privatePlaylists = (Array.isArray(privateRaw) ? privateRaw : [])
      .map((pl: any) => mapDiscoverPlaylist(pl, '私人推荐'))
      .filter((pl) => pl.id && pl.name)
      .slice(0, 6)

    const dailyBody = bodyOf(results[3])
    const dailyRaw = (dailyBody.data && (dailyBody.data.dailySongs || dailyBody.data.recommend)) || dailyBody.recommend || []
    const dailySongs = (Array.isArray(dailyRaw) ? dailyRaw : [])
      .map(mapSongRecord)
      .filter((song: UnifiedSong) => song.id && song.name)
      .slice(0, 12)

    return {
      loggedIn,
      user: { userId: info.userId, nickname: info.nickname || '', avatar: info.avatar || '' },
      dailySongs,
      playlists: privatePlaylists.concat(publicPlaylists).slice(0, 10),
      podcasts,
      updatedAt: Date.now(),
    }
  }

  async artistDetail(id: string, limit: number): Promise<any> {
    let detailBody: any = {}
    try {
      const detail = await ncm.artist_detail({ id, cookie: this.cookie, timestamp: Date.now() })
      detailBody = detail.body || detail || {}
    } catch (e: any) {
      console.warn('[ArtistDetail] detail failed:', e.message)
    }
    let rawSongs: any[] = []
    try {
      const list = await ncm.artist_songs({ id, order: 'hot', limit, offset: 0, cookie: this.cookie, timestamp: Date.now() })
      const b = list.body || list || {}
      rawSongs = b.songs || (b.data && b.data.songs) || []
    } catch (e: any) {
      console.warn('[ArtistSongs] hot failed:', e.message)
    }
    if (!rawSongs.length) {
      const top = await ncm.artist_top_song({ id, cookie: this.cookie, timestamp: Date.now() })
      const b = top.body || top || {}
      rawSongs = b.songs || []
    }
    const artist = detailBody.artist || (detailBody.data && (detailBody.data.artist || detailBody.data)) || {}
    const songs = rawSongs.map(mapSongRecord).filter((s: UnifiedSong) => s.id).slice(0, limit)
    return {
      id,
      artist: {
        id: artist.id || id,
        name: artist.name || artist.artistName || '',
        avatar: artist.avatar || artist.cover || artist.picUrl || artist.img1v1Url || '',
        brief: artist.briefDesc || artist.description || artist.desc || '',
        musicSize: artist.musicSize || artist.songSize || 0,
        albumSize: artist.albumSize || 0,
      },
      songs,
      body: detailBody,
    }
  }

  async songComments(id: string, limit: number, offset: number): Promise<any> {
    const r = await ncm.comment_music({ id, limit, offset, cookie: this.cookie, timestamp: Date.now() })
    const body = r.body || r || {}
    const raw = body.hotComments && offset === 0 ? body.hotComments : body.comments || []
    const comments = ((raw || []) as any[])
      .map((c) => ({
        id: c.commentId,
        content: c.content || '',
        likedCount: c.likedCount || 0,
        time: c.time || 0,
        user: c.user ? { id: c.user.userId, nickname: c.user.nickname || '', avatar: c.user.avatarUrl || '' } : null,
      }))
      .filter((c) => c.content)
    return { id, total: body.total || 0, comments, hot: !!(body.hotComments && offset === 0), body }
  }

  async likeCheck(ids: string[], info: NeteaseLoginInfo): Promise<any> {
    let likedIds: string[] = []
    try {
      if (typeof ncm.song_like_check === 'function') {
        const checked = await ncm.song_like_check({
          ids: JSON.stringify(ids.map(Number).filter(Boolean)),
          cookie: this.cookie,
          timestamp: Date.now(),
        })
        const data = (checked.body && (checked.body.data || checked.body.ids)) || checked.body || {}
        if (Array.isArray(data)) likedIds = data.map(String)
        else if (data && typeof data === 'object') {
          ids.forEach((id) => {
            if ((data as any)[id] || (data as any)[String(id)] || (data as any)[Number(id)]) likedIds.push(String(id))
          })
        }
      }
    } catch (e: any) {
      console.warn('[LikeCheck] direct check failed:', e.message)
    }
    if (!likedIds.length) {
      const r = await ncm.likelist({ uid: info.userId, cookie: this.cookie, timestamp: Date.now() })
      likedIds = ((r.body && r.body.ids) || []).map(String)
    }
    const set = new Set(likedIds)
    const liked: Record<string, boolean> = {}
    ids.forEach((id) => {
      liked[id] = set.has(String(id))
    })
    return { loggedIn: true, ids, liked }
  }

  async like(id: string, nextLike: boolean): Promise<any> {
    const r = await ncm.like({ id, like: String(nextLike), cookie: this.cookie, timestamp: Date.now() })
    const code = (r.body && r.body.code) || (r as any).code || 200
    return { loggedIn: true, id, liked: nextLike, code, body: r.body || r }
  }

  async playlistCreate(name: string, privacy: string): Promise<any> {
    const r = await ncm.playlist_create({ name, privacy, cookie: this.cookie, timestamp: Date.now() })
    const created = (r.body && (r.body.playlist || r.body.data)) || {}
    return { loggedIn: true, playlist: created, body: r.body || r }
  }

  async playlistAddSong(pid: string, id: string): Promise<any> {
    const attempts: any[] = []
    let finalBody: any = null
    let finalCode = 0
    let finalMessage = ''
    let success = false

    const primary = await ncm.playlist_tracks({ op: 'add', pid, tracks: String(id), cookie: this.cookie, timestamp: Date.now() })
    finalBody = primary.body || primary
    finalCode = normalizeApiCode(primary)
    finalMessage = normalizeApiMessage(primary)
    success = finalCode === 200 && !(finalBody && finalBody.error)
    attempts.push({ api: 'playlist_tracks', code: finalCode, message: finalMessage, body: finalBody })

    if (!success && typeof ncm.playlist_track_add === 'function') {
      try {
        const fallback = await ncm.playlist_track_add({ pid, ids: String(id), cookie: this.cookie, timestamp: Date.now() })
        finalBody = fallback.body || fallback
        finalCode = normalizeApiCode(fallback)
        finalMessage = normalizeApiMessage(fallback)
        success = finalCode === 200 && !(finalBody && finalBody.error)
        attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: finalBody })
      } catch (fallbackErr: any) {
        const errBody = fallbackErr.body || fallbackErr.response || {}
        finalBody = errBody
        finalCode = normalizeApiCode(errBody)
        finalMessage = normalizeApiMessage(errBody) || fallbackErr.message || ''
        attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: errBody })
      }
    }

    return { success, finalCode, finalMessage, finalBody, attempts }
  }

  async loginQrKey(): Promise<any> {
    const r = await ncm.login_qr_key({ timestamp: Date.now() })
    return { key: r.body && r.body.data && r.body.data.unikey }
  }

  async loginQrCreate(key: string): Promise<any> {
    const r = await ncm.login_qr_create({ key, qrimg: true, timestamp: Date.now() })
    const d = r.body && r.body.data
    return { img: d && d.qrimg, url: d && d.qrurl }
  }

  async loginQrCheck(key: string): Promise<any> {
    let r = await ncm.login_qr_check({ key, noCookie: true, timestamp: Date.now() })
    let body = r.body || {}
    let code = Number(body.code || (r as any).code)
    let msg = body.message || (r as any).message || ''
    let cookie = readCookieFromResponse(r)
    if (code === 803 && !cookie) {
      try {
        const retry = await ncm.login_qr_check({ key, timestamp: Date.now() })
        const retryCookie = readCookieFromResponse(retry)
        if (retryCookie) {
          r = retry
          body = retry.body || body
          code = Number(body.code || (retry as any).code || code)
          msg = body.message || (retry as any).message || msg
          cookie = retryCookie
        }
      } catch (retryErr: any) {
        console.warn('[Login] qr cookie retry failed:', retryErr.message)
      }
    }
    // 803 = 授权成功, 802 = 已扫待确认, 801 = 等待扫码, 800 = 二维码过期
    if (code === 803) {
      if (cookie) this.saveCookie(cookie)
      let info = await this.loginInfo()
      if (!info.loggedIn) {
        const profile = body.profile || (body.data && body.data.profile) || {}
        info = normalizeLoginInfo(profile, body.account || (body.data && body.data.account), body.data || body)
      }
      if (!info.loggedIn && cookie) {
        info = {
          loggedIn: true,
          pendingProfile: true,
          nickname: body.nickname || (body.profile && body.profile.nickname) || '网易云用户',
          avatar: body.avatarUrl || (body.profile && body.profile.avatarUrl) || '',
          vipType: 0,
          vipLevel: 'none',
          isVip: false,
          isSvip: false,
          vipLabel: '无VIP',
        }
      }
      return { code, message: msg, ...info, hasCookie: !!cookie }
    }
    return { code, message: msg, nickname: body.nickname, avatar: body.avatarUrl }
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

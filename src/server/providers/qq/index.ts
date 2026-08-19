import type {
  DiscoverResult,
  DiscoverSection,
  MusicAuthResult,
  PlaylistListResult,
  PlaylistTracksResult,
} from '@shared/music-contract'
import type { LyricDoc, PlaybackRestriction, QQLoginInfo, UnifiedPlaylist, UnifiedSong } from '@shared/models'
import {
  QQ_QUALITY_CANDIDATE_TEMPLATES,
  normalizeQualityPreference,
  qualityCandidatesFrom,
} from '@shared/models'
import { buildLyricLines } from '@shared/lyrics'
import type { CredentialStore, ProviderLikedTracksResult, UpstreamPlaybackResource } from '../../types'
import { normalizeCookieHeader, rawCookieFallback } from '../../util/cookies'
import {
  asArray,
  asRecord,
  at,
  booleanValue,
  errorMessage,
  field,
  numberValue,
  stringValue,
} from '../../util/unknown'
import { QQClient, QQ_SEARCH_URL, QQ_SMARTBOX_URL, qqCommonParams } from './client'
import {
  decodeQQLyricText,
  isQQFavoritePlaylist,
  isQzoneBackgroundPlaylist,
  mapQQPlaylist,
  mapQQPlaylistTrack,
  mapQQSmartSong,
  mapQQTrack,
  normalizeQQSongId,
} from './mappers'
import { QQSession, normalizeQQCookieInput } from './session'

const QQ_LEGACY_VKEY_URL = 'https://c.y.qq.com/base/fcgi-bin/fcg_music_express_mobile3.fcg'
const QQ_TRIAL_DURATION_SECONDS = 30
const QQ_TRIAL_STREAM_ORIGIN = 'https://dl.stream.qqmusic.qq.com'
const QQ_PROFILE_CACHE_MS = 60_000
const QQ_PLAYLIST_PAGE_SIZE = 300
const QQ_PLAYLIST_MAX_PAGES = 10
/** RecommendFeed 里官方「今日为你推荐」那一行的货架 id；同一响应还会夹带 203/204，必须按 id 认 */
const QQ_FEED_SHELF_FOR_YOU = 201
/** RecommendFeed 卡片类型：500=歌单（id 是 dissid），800=听歌排行，-1=运营位 */
const QQ_FEED_CARD_TYPE_PLAYLIST = 500
/**
 * 卡片 subtype → 固定展示名。上游对 511 不给标题，回查到的是「<昵称>的新发风向」这种
 * 带用户名的歌单实名，做入口名不合适，统一按官方叫法显示。
 */
const QQ_FEED_SUBTYPE_LABELS: Readonly<Record<number, string>> = {
  510: '每日30首',
  511: '新歌推荐',
}
/**
 * 「百万收藏」是官方固定歌单（非个性化），不出现在 201 货架里，但官方推荐行有这一位。
 * 固定 dissid 补齐第三张卡；取不到就少一张，不影响其余内容。
 */
const QQ_MILLION_FAVORITES_DISSID = '211111'

interface FileCandidate {
  prefix: string
  ext: string
  level: string
  label: string
  mediaId: string
  filename: string
}

function playbackRestriction(
  category: PlaybackRestriction['category'],
  message: string,
  action: PlaybackRestriction['action'],
  extra?: Record<string, unknown>,
): PlaybackRestriction {
  return { provider: 'qq', category, action, message, ...(extra ?? {}) }
}

export function classifyQQPlaybackRestriction(
  rawInfo: unknown,
  session: { hasSession: boolean; hasPlaybackKey: boolean },
): PlaybackRestriction {
  const info = asRecord(rawInfo)
  const rawMessage = stringValue(info.msg ?? info.tips ?? info.errmsg ?? info.message).trim()
  const code = numberValue(info.result ?? info.code ?? info.errtype)
  const lower = rawMessage.toLowerCase()
  if (!session.hasSession) {
    return playbackRestriction('login_required', 'QQ 音乐需要登录或授权后才能获取播放地址', 'login', {
      code,
      rawMessage,
    })
  }
  if (!session.hasPlaybackKey && code === 104003) {
    return playbackRestriction(
      'login_required',
      'QQ 音乐当前只拿到了网页登录状态，还缺少播放授权，请重新打开官方 QQ 音乐登录窗口完成授权',
      'login',
      { code, rawMessage, missingPlaybackKey: true },
    )
  }
  if (code === 104003) {
    return playbackRestriction(
      'copyright_unavailable',
      'QQ 音乐没有给当前版本返回播放地址，通常是版权、会员或官方版本限制',
      'none',
      { code, rawMessage },
    )
  }
  if (/vip|会员|付费|购买|数字专辑|专辑|pay/.test(lower + rawMessage)) {
    return playbackRestriction('paid_required', 'QQ 音乐歌曲需要会员、购买或数字专辑权限', 'upgrade', {
      code,
      rawMessage,
    })
  }
  if (code !== 0) {
    return playbackRestriction(
      'copyright_unavailable',
      rawMessage || 'QQ 音乐版权暂不可播或仅官方客户端可播',
      'none',
      {
        code,
        rawMessage,
      },
    )
  }
  return playbackRestriction(
    'url_unavailable',
    'QQ 音乐没有返回播放地址，可能受版权、会员或官方客户端限制',
    'retry',
    {
      code,
      rawMessage,
    },
  )
}

function toAuthResult(info: QQLoginInfo): MusicAuthResult {
  return {
    provider: 'qq',
    loggedIn: info.loggedIn,
    credentialInvalidated: info.credentialInvalidated,
    preview: info.preview,
    userId: info.userId,
    nickname: info.nickname,
    avatar: info.avatar,
    vipType: info.vipType,
    hasCookie: info.hasCookie,
    playbackKeyReady: info.playbackKeyReady,
    profileSource: info.profileSource,
    profileUnavailable: info.profileUnavailable,
  }
}

export class QQProvider {
  readonly id = 'qq' as const
  private readonly client: QQClient
  /** loginInfo 的短期缓存：likedTracks → userPlaylists → playlistTracks 会连着调 3 次同一个请求。 */
  private profileCache: { cookie: string; expiresAt: number; info: QQLoginInfo } | null = null

  constructor(private readonly credentials: CredentialStore) {
    this.client = new QQClient(() => this.cookie)
  }

  get cookie(): string {
    return this.credentials.get('qq')
  }

  get session(): QQSession {
    return new QQSession(this.cookie)
  }

  saveCookie(raw: unknown): void {
    this.profileCache = null
    this.credentials.set('qq', normalizeCookieHeader(raw) || rawCookieFallback(raw))
  }

  acceptCookieInput(raw: unknown): { ok: boolean; normalized: string } {
    const normalized = normalizeQQCookieInput(String(raw || ''))
    const session = new QQSession(normalized)
    if (!session.uin || !session.musicKey) return { ok: false, normalized }
    this.saveCookie(normalized)
    return { ok: true, normalized }
  }

  acceptCredential(raw: unknown): boolean {
    return this.acceptCookieInput(raw).ok
  }

  private profileFromBody(rawBody: unknown, session: QQSession): QQLoginInfo {
    const body = asRecord(rawBody)
    const data = asRecord(body.data ?? body.profile ?? body.creator ?? body.result)
    const creator = asRecord(data.creator ?? data.user ?? data.profile ?? data)
    const vipInfo = asRecord(data.vipInfo ?? data.vipinfo ?? data.vip ?? creator.vipInfo ?? creator.vipinfo)
    const profileNickname = stringValue(
      creator.nick ?? creator.nickname ?? creator.name ?? creator.hostname ?? creator.title,
    )
    const profileAvatar = stringValue(creator.headpic ?? creator.avatar ?? creator.avatarUrl ?? creator.logo)
    const cookieNickname = session.nickname()
    const nickname = profileNickname || cookieNickname
    const avatar = profileAvatar || session.avatar()
    let vipType = numberValue(
      session.obj.vip_type ??
        session.obj.viptype ??
        session.obj.vip_level ??
        session.obj.vipLevel ??
        data.vipType ??
        data.vip_type ??
        vipInfo.vipType ??
        vipInfo.vip_type ??
        creator.vipType ??
        creator.vip_type,
    )
    if (!vipType) {
      const vipFlag =
        data.isVip ??
        data.is_vip ??
        data.vipFlag ??
        data.vipflag ??
        creator.isVip ??
        creator.is_vip ??
        vipInfo.isVip ??
        vipInfo.is_vip ??
        vipInfo.vipFlag
      if (booleanValue(vipFlag) || numberValue(vipFlag) > 0) vipType = 1
    }
    const uin = session.uin
    return {
      provider: 'qq',
      loggedIn: Boolean(uin && session.musicKey),
      preview: false,
      userId: uin,
      nickname: nickname || (uin ? `QQ ${uin}` : 'QQ 音乐'),
      avatar,
      vipType,
      hasCookie: Boolean(this.cookie),
      playbackKeyReady: session.playbackReady,
      profileSource:
        profileNickname || profileAvatar ? 'qq-profile' : cookieNickname || avatar ? 'cookie' : 'fallback',
    }
  }

  async loginInfo(): Promise<QQLoginInfo> {
    const cookie = this.cookie
    const cached = this.profileCache
    if (cached && cached.cookie === cookie && cached.expiresAt > Date.now()) return cached.info

    const info = await this.fetchLoginInfo()
    // 未登录态不缓存：登录窗口刚回填 cookie 时要立刻反映出来。
    if (info.loggedIn) {
      this.profileCache = { cookie, expiresAt: Date.now() + QQ_PROFILE_CACHE_MS, info }
    } else {
      this.profileCache = null
    }
    return info
  }

  private async fetchLoginInfo(): Promise<QQLoginInfo> {
    const session = this.session
    if (!session.uin || !session.musicKey) {
      const credentialInvalidated = Boolean(this.cookie)
      if (credentialInvalidated) this.saveCookie('')
      return { provider: 'qq', loggedIn: false, hasCookie: false, credentialInvalidated }
    }
    const fallback = this.profileFromBody(null, session)
    try {
      const body = await this.client.getJSON('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg', {
        ...qqCommonParams(session.uin),
        cid: '205360838',
        userid: session.uin,
        reqfrom: '1',
      })
      const info = this.profileFromBody(body, session)
      if (numberValue(field(body, 'code')) === 1000 || numberValue(field(body, 'result')) === 301) {
        return { ...fallback, profileUnavailable: true }
      }
      return info
    } catch (error) {
      console.warn('[QQAuth] profile check failed:', errorMessage(error))
      return { ...fallback, profileUnavailable: true }
    }
  }

  async authStatus(): Promise<MusicAuthResult> {
    return toAuthResult(await this.loginInfo())
  }

  async smartboxSearch(keywords: string, limit: number): Promise<UnifiedSong[]> {
    const json = await this.client.getJSON(
      QQ_SMARTBOX_URL,
      { ...qqCommonParams(), key: keywords },
      { cookie: false },
    )
    return asArray(at(json, 'data', 'song', 'itemlist'))
      .slice(0, Math.max(1, Math.min(limit || 6, 10)))
      .map(mapQQSmartSong)
      .filter((song) => Boolean(song.mid && song.name))
  }

  async songDetail(mid: string, fallback?: Partial<UnifiedSong>): Promise<UnifiedSong> {
    if (!mid) {
      if (fallback) return mapQQTrack({}, fallback)
      return mapQQTrack({})
    }
    const json = await this.client.callMusicu('songinfo', 'music.pf_song_detail_svr', 'get_song_detail_yqq', {
      song_mid: mid,
    })
    return mapQQTrack(at(json, 'songinfo', 'data', 'track_info'), fallback)
  }

  /**
   * 真·搜索接口。smartbox 是搜索联想（上限 10 条、不回专辑/时长/音质），
   * client_search_cp 一次就带回完整字段，省掉逐条 songDetail 的 N+1。
   */
  async search(keywords: string, limit: number, page = 1): Promise<UnifiedSong[]> {
    const normalized = String(keywords || '').trim()
    if (!normalized) return []
    const size = Math.max(1, Math.min(limit || 20, 100))
    const json = await this.client.getJSON(
      QQ_SEARCH_URL,
      {
        ...qqCommonParams(this.session.uin),
        w: normalized,
        p: Math.max(1, Math.floor(page)),
        n: size,
        t: 0,
        aggr: 1,
        cr: 1,
        lossless: 0,
        flag_qc: 0,
        catZhida: 1,
        ct: 24,
        qqmusic_ver: 1298,
        remoteplace: 'txt.yqq.song',
      },
      { cookie: false },
    )
    const list = asArray(at(json, 'data', 'song', 'list'))
    const seen = new Set<string>()
    return list
      .map((item) => mapQQTrack(item))
      .filter((song) => {
        if (!song.name || !song.mid) return false
        const key = String(song.mid)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, size)
  }

  private async legacyTrialUrl(
    songmid: string,
    mediaIds: string[],
    guid: string,
    requestedQuality: string,
  ): Promise<UpstreamPlaybackResource | null> {
    for (const mediaId of mediaIds) {
      const filename = `C400${mediaId}.m4a`
      try {
        const body = await this.client.getJSON(
          QQ_LEGACY_VKEY_URL,
          {
            g_tk: '5381',
            loginUin: '0',
            hostUin: '0',
            format: 'json',
            inCharset: 'utf8',
            outCharset: 'utf-8',
            notice: '0',
            platform: 'yqq',
            needNewCode: '0',
            cid: '205361747',
            uin: '0',
            songmid,
            filename,
            guid,
          },
          { cookie: false, headers: { Referer: 'https://y.qq.com/' } },
        )
        const item = asArray(at(body, 'data', 'items')).find((candidate) =>
          Boolean(stringValue(field(candidate, 'vkey'))),
        )
        const vkey = stringValue(field(item, 'vkey')).trim()
        if (!vkey) continue

        const upstreamFilename = stringValue(field(item, 'filename'), filename)
        const safeFilename = /^[A-Za-z0-9._-]+$/.test(upstreamFilename) ? upstreamFilename : filename
        const query = new URLSearchParams({ vkey, guid, uin: '0', fromtag: '66' })
        const restriction = playbackRestriction(
          'trial_only',
          `QQ 音乐当前仅提供 ${QQ_TRIAL_DURATION_SECONDS} 秒试听，完整播放需要会员、购买或可用版权`,
          'upgrade',
          { duration: QQ_TRIAL_DURATION_SECONDS, source: 'qq-legacy-vkey' },
        )
        return {
          provider: 'qq',
          url: `${QQ_TRIAL_STREAM_ORIGIN}/${safeFilename}?${query.toString()}`,
          headers: {},
          trial: true,
          playable: true,
          level: 'aac',
          quality: 'AAC/M4A · 30 秒试听',
          filename: safeFilename,
          requestedQuality,
          trialDuration: QQ_TRIAL_DURATION_SECONDS,
          trialInfo: {
            start: 0,
            end: QQ_TRIAL_DURATION_SECONDS,
            duration: QQ_TRIAL_DURATION_SECONDS,
            source: 'qq-legacy-vkey',
          },
          restriction,
          reason: restriction.category,
          message: restriction.message,
        }
      } catch (error) {
        console.warn('[QQPlayback] trial vkey failed', {
          mid: songmid,
          filename,
          error: errorMessage(error),
        })
      }
    }
    return null
  }

  async songUrl(mid: string, mediaMid: string, qualityPreference: string): Promise<UpstreamPlaybackResource> {
    const songmid = String(mid || '').trim()
    if (!songmid) {
      return {
        provider: 'qq',
        url: null,
        headers: {},
        trial: false,
        playable: false,
        error: 'MISSING_MID',
        message: 'Missing QQ song mid',
      }
    }

    const guid = String(10_000_000 + Math.floor(Math.random() * 90_000_000))
    const session = this.session
    const uin = session.uin || '0'
    const musicKey = session.musicKey
    const playbackKey = session.playbackKey
    const requestedQuality = normalizeQualityPreference(qualityPreference)
    const mediaIds = [String(mediaMid || '').trim(), songmid].filter(
      (value, index, values) => Boolean(value) && values.indexOf(value) === index,
    )
    const fileCandidates: FileCandidate[] = mediaIds.flatMap((mediaId) =>
      qualityCandidatesFrom(requestedQuality, QQ_QUALITY_CANDIDATE_TEMPLATES).map((candidate) => ({
        ...candidate,
        mediaId,
        filename: `${candidate.prefix}${mediaId}${candidate.ext}`,
      })),
    )
    const filenames = fileCandidates.map((candidate) => candidate.filename)
    const param: Record<string, unknown> = {
      guid,
      songmid: filenames.length ? filenames.map(() => songmid) : [songmid],
      songtype: filenames.length ? filenames.map(() => 0) : [0],
      uin,
      loginflag: 1,
      platform: '20',
    }
    if (filenames.length) param.filename = filenames
    const comm: Record<string, unknown> = { uin, format: 'json', ct: musicKey ? 19 : 24 }
    if (musicKey) comm.authst = musicKey

    const json = await this.client.callMusicu('req_0', 'vkey.GetVkeyServer', 'CgiGetVkey', param, {
      comm,
      cookie: true,
    })
    const data = at(json, 'req_0', 'data')
    const infos = asArray(field(data, 'midurlinfo'))
    const info = infos.find((candidate) => Boolean(stringValue(field(candidate, 'purl')))) ?? infos[0]
    const purl = stringValue(field(info, 'purl'))
    if (purl) {
      const sip = stringValue(asArray(field(data, 'sip'))[0], 'https://ws.stream.qqmusic.qq.com/')
      const returnedFilename = stringValue(field(info, 'filename'))
      const fileMeta = fileCandidates.find((candidate) => candidate.filename === returnedFilename)
      return {
        provider: 'qq',
        url: `${sip}${purl}`,
        headers: {},
        trial: false,
        playable: true,
        level: fileMeta?.level || returnedFilename,
        quality: fileMeta?.label || returnedFilename,
        filename: returnedFilename,
        requestedQuality,
      }
    }

    const trialFallback = await this.legacyTrialUrl(songmid, mediaIds, guid, requestedQuality)
    if (trialFallback) {
      return {
        ...trialFallback,
        loggedIn: Boolean(uin !== '0' && musicKey),
        playbackKeyReady: Boolean(uin !== '0' && playbackKey),
      }
    }

    const restriction = classifyQQPlaybackRestriction(info, {
      hasSession: Boolean(uin !== '0' && musicKey),
      hasPlaybackKey: Boolean(uin !== '0' && playbackKey),
    })
    const diagnostics = {
      qqCode: numberValue(field(info, 'result') ?? field(info, 'code') ?? field(info, 'errtype')),
      rawMessage: stringValue(field(info, 'msg') ?? field(info, 'tips') ?? field(info, 'errmsg')),
      tried: fileCandidates.map((candidate) => `${candidate.label} · ${candidate.filename}`),
    }
    console.warn('[QQPlayback] no URL', {
      mid: songmid,
      requestedQuality,
      category: restriction.category,
      playbackKeyReady: Boolean(uin !== '0' && playbackKey),
      ...diagnostics,
    })
    return {
      provider: 'qq',
      url: null,
      headers: {},
      trial: false,
      playable: false,
      error: 'QQ_URL_UNAVAILABLE',
      loggedIn: Boolean(uin !== '0' && musicKey),
      playbackKeyReady: Boolean(uin !== '0' && playbackKey),
      requestedQuality,
      restriction,
      reason: restriction.category,
      message: restriction.message,
      diagnostics,
    }
  }

  async resolvePlayback(song: UnifiedSong, quality: string): Promise<UpstreamPlaybackResource> {
    return this.songUrl(song.mid || song.songmid || String(song.id), song.mediaMid || '', quality)
  }

  async getLyrics(id: string | number, mid?: string): Promise<LyricDoc> {
    return this.lyric(mid || '', String(id))
  }

  async lyric(mid: string, id: string): Promise<LyricDoc> {
    const songMID = String(mid || '').trim()
    const songID = normalizeQQSongId(id)
    if (!songMID && !songID) {
      return {
        provider: 'qq',
        error: 'Missing QQ song mid or id',
        lyric: '',
        tlyric: '',
        yrc: '',
        lines: [],
        source: 'qq-empty',
      }
    }

    let lyric = ''
    let tlyric = ''
    let qrc = ''
    let roma = ''
    let source = 'qq-musicu'
    try {
      const param: Record<string, unknown> = {}
      if (songMID) param.songMID = songMID
      if (songID) param.songID = songID
      const json = await this.client.callMusicu(
        'lyric',
        'music.musichallSong.PlayLyricInfo',
        'GetPlayLyricInfo',
        param,
        { cookie: true },
      )
      const data = at(json, 'lyric', 'data')
      lyric = decodeQQLyricText(field(data, 'lyric'))
      tlyric = decodeQQLyricText(field(data, 'trans'))
      qrc = decodeQQLyricText(field(data, 'qrc'))
      roma = decodeQQLyricText(field(data, 'roma'))
    } catch (error) {
      console.warn('[QQLyrics] musicu failed:', errorMessage(error))
    }

    if (!lyric && songMID) {
      try {
        const body = await this.client.getJSON(
          'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
          {
            ...qqCommonParams(this.session.uin),
            songmid: songMID,
            songtype: '0',
            nobase64: '1',
          },
          { headers: { Referer: 'https://y.qq.com/portal/player.html' } },
        )
        lyric = decodeQQLyricText(field(body, 'lyric'))
        tlyric = decodeQQLyricText(field(body, 'trans') ?? field(body, 'tlyric')) || tlyric
        source = 'qq-legacy'
      } catch (error) {
        console.warn('[QQLyrics] legacy failed:', errorMessage(error))
      }
    }

    return {
      provider: 'qq',
      id: songID || '',
      mid: songMID,
      lyric,
      tlyric,
      yrc: '',
      lines: buildLyricLines({ lyric, tlyric, yrc: '' }),
      qrc,
      roma,
      source: lyric ? source : 'qq-empty',
    }
  }

  async userPlaylists(_limit = 200): Promise<PlaylistListResult> {
    const info = await this.loginInfo()
    if (!info.loggedIn || !info.userId) return { provider: 'qq', loggedIn: false, playlists: [] }
    const uin = String(info.userId)
    const createdRequest = this.client.getJSON(
      'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss',
      { ...qqCommonParams(uin), hostuin: uin, sin: 0, size: 200 },
      { headers: { Referer: 'https://y.qq.com/portal/profile.html' } },
    )
    const collectedRequest = this.client.getJSON(
      'https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg',
      { ct: 20, cid: 205360956, userid: uin, reqtype: 3, sin: 0, ein: 80 },
      { headers: { Referer: 'https://y.qq.com/portal/profile.html' } },
    )
    const [createdResult, collectedResult] = await Promise.allSettled([createdRequest, collectedRequest])
    const created =
      createdResult.status === 'fulfilled'
        ? asArray(at(createdResult.value, 'data', 'disslist')).map((playlist) =>
            mapQQPlaylist(playlist, 'created'),
          )
        : []
    const collected =
      collectedResult.status === 'fulfilled'
        ? asArray(at(collectedResult.value, 'data', 'cdlist')).map((playlist) =>
            mapQQPlaylist(playlist, 'collect'),
          )
        : []
    const seen = new Set<string>()
    const playlists = created
      .concat(collected)
      .filter((playlist) => {
        const id = String(playlist.id)
        // dissid=0 是「本地上传」「QZone 背景音乐」这类客户端伪歌单，点进去必然是空的
        if (!id || id === '0' || !playlist.name) return false
        if (seen.has(id) || isQzoneBackgroundPlaylist(playlist)) return false
        seen.add(id)
        return true
      })
      .map((playlist) =>
        isQQFavoritePlaylist(playlist) ? { ...playlist, favorite: true, subscribed: false } : playlist,
      )
      .sort((left, right) => Number(right.favorite) - Number(left.favorite))
    return { provider: 'qq', loggedIn: true, identity: uin, playlists }
  }

  async likedTracks(offset: number, limit: number): Promise<ProviderLikedTracksResult> {
    const safeOffset = Math.max(0, Math.floor(offset || 0))
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit || 100)))
    const info = await this.loginInfo()
    if (!info.loggedIn || !info.userId) {
      return {
        provider: 'qq',
        loggedIn: false,
        tracks: [],
        offset: safeOffset,
        limit: safeLimit,
        total: 0,
        hasMore: false,
        error: 'LOGIN_REQUIRED',
        message: '登录 QQ 音乐账号后才能读取喜欢的音乐',
      }
    }

    const playlists = await this.userPlaylists()
    const likedPlaylist = playlists.playlists.find(isQQFavoritePlaylist)
    if (!likedPlaylist?.id) {
      return {
        provider: 'qq',
        loggedIn: true,
        identity: String(info.userId),
        tracks: [],
        offset: safeOffset,
        limit: safeLimit,
        total: 0,
        hasMore: false,
        error: 'LIKED_TRACKS_UNAVAILABLE',
      }
    }

    const detail = await this.playlistTracks(String(likedPlaylist.id))
    const allTracks = detail.tracks
    const tracks = allTracks.slice(safeOffset, safeOffset + safeLimit)
    return {
      provider: 'qq',
      loggedIn: true,
      identity: String(info.userId),
      tracks,
      offset: safeOffset,
      limit: safeLimit,
      total: allTracks.length,
      hasMore: safeOffset + tracks.length < allTracks.length,
    }
  }

  /**
   * 歌单详情。主路径是 musicu 的 aiDissInfo：匿名可用、带分页、songlist 是嵌套形态
   * （album.mid / file.media_mid / file.size_*），mapQQPlaylistTrack 直接吃。
   * 老的 fcg_ucc_getcdinfo_byids_cp.fcg 现在对非自有歌单一律回 subcode 4000
   * "check privacy error!"，只留作兜底。
   */
  async playlistTracks(id: string): Promise<PlaylistTracksResult> {
    const raw = String(id || '').trim()
    if (!raw) return { provider: 'qq', loggedIn: true, playlist: null, tracks: [] }

    const modern = await this.dissInfoTracks(raw)
    if (modern) return modern
    return this.legacyCdlistTracks(raw)
  }

  private async dissInfoPage(
    playlistId: string,
    begin: number,
  ): Promise<{ data: unknown; tracks: UnifiedSong[] }> {
    const json = await this.client.callMusicu(
      'req_0',
      'music.srfDissInfo.aiDissInfo',
      'uniform_get_Dissinfo',
      {
        disstid: Number(playlistId) || playlistId,
        userinfo: 1,
        tag: 1,
        song_begin: begin,
        song_num: QQ_PLAYLIST_PAGE_SIZE,
      },
      { cookie: true },
    )
    const data = at(json, 'req_0', 'data')
    const tracks = asArray(field(data, 'songlist'))
      .map(mapQQPlaylistTrack)
      .filter((song) => Boolean(song.name && (song.mid || song.id)))
    return { data, tracks }
  }

  private async dissInfoTracks(playlistId: string): Promise<PlaylistTracksResult | null> {
    try {
      const first = await this.dissInfoPage(playlistId, 0)
      if (!first.tracks.length) return null

      const total = numberValue(field(first.data, 'total_song_num'))
      const tracks = [...first.tracks]
      // 老接口一次回全量；这里按 total 续拉，避免大歌单被静默截断。
      // 终止条件用"短页即末页"而不是只判空页：上游若重复回同一页，按 total 循环会拉出重复曲目。
      let lastPageSize = first.tracks.length
      for (
        let page = 1;
        lastPageSize >= QQ_PLAYLIST_PAGE_SIZE && tracks.length < total && page < QQ_PLAYLIST_MAX_PAGES;
        page += 1
      ) {
        const next = await this.dissInfoPage(playlistId, page * QQ_PLAYLIST_PAGE_SIZE)
        lastPageSize = next.tracks.length
        if (!lastPageSize) break
        tracks.push(...next.tracks)
      }
      if (total > tracks.length) {
        console.warn('[QQPlaylist] 歌单未拉全', { playlistId, total, loaded: tracks.length })
      }

      const dirinfo = asRecord(field(first.data, 'dirinfo'))
      const playlist: UnifiedPlaylist = {
        provider: 'qq',
        type: 'playlist',
        id: playlistId,
        name: stringValue(dirinfo.title),
        cover: stringValue(asRecord(dirinfo.picurl).picurl ?? dirinfo.picurl ?? dirinfo.logo),
        trackCount: total || tracks.length,
        creator: stringValue(asRecord(dirinfo.creator).nick),
      }
      return { provider: 'qq', loggedIn: true, playlist, tracks }
    } catch (error) {
      console.warn('[QQPlaylist] aiDissInfo failed:', errorMessage(error))
      return null
    }
  }

  private async legacyCdlistTracks(playlistId: string): Promise<PlaylistTracksResult> {
    const info = await this.loginInfo()
    const result = await this.client.getJSON(
      'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg',
      { ...qqCommonParams(info.userId), type: 1, utf8: 1, disstid: playlistId },
      { headers: { Referer: 'https://y.qq.com/n/yqq/playlist' } },
    )
    const detail = asArray(field(result, 'cdlist'))[0]
    const tracks = asArray(field(detail, 'songlist'))
      .map(mapQQPlaylistTrack)
      .filter((song) => Boolean(song.name && (song.mid || song.id)))
    const playlist: UnifiedPlaylist = {
      provider: 'qq',
      type: 'playlist',
      id: playlistId,
      name: stringValue(field(detail, 'dissname') ?? field(detail, 'diss_name') ?? field(detail, 'name')),
      cover: stringValue(field(detail, 'logo') ?? field(detail, 'diss_cover')),
      trackCount: tracks.length,
    }
    return { provider: 'qq', loggedIn: Boolean(info.loggedIn), playlist, tracks }
  }

  /**
   * 发现页 = 官方「今日为你推荐」那一行，只服务登录用户。
   * 上游把它放在 RecommendFeed 的 201 号货架（title「为你打造」）；同一次响应里
   * 还会夹带 203（普通推荐歌单）、204（更多按钮），货架数量每次都不一样，
   * 所以必须按 shelf id 认，不能靠顺序或数量。
   */
  async discover(limit = 12): Promise<DiscoverResult> {
    const info = await this.loginInfo()
    if (!info.loggedIn) return { provider: 'qq', supported: true, loggedIn: false, sections: [] }

    const size = Math.max(1, Math.min(limit || 12, 30))
    try {
      const section = await this.recommendFeedSection(size)
      return { provider: 'qq', supported: true, loggedIn: true, sections: section ? [section] : [] }
    } catch (error) {
      console.warn('[QQDiscover] recommend feed failed:', errorMessage(error))
      return { provider: 'qq', supported: true, loggedIn: true, sections: [] }
    }
  }

  /**
   * 201 号货架里只有 type=500 的卡是歌单（id 即 dissid，能直接喂 playlistTracks）；
   * type=800 是听歌排行、-1 是运营位，播放器里没有播放落点。
   * 展示名优先用 subtype 固定叫法（上游对 511 压根不给标题），都没有才回查歌单实名。
   * 最后补一张官方「百万收藏」，凑齐推荐行的三个位置。
   */
  private async recommendFeedSection(limit: number): Promise<DiscoverSection | null> {
    const json = await this.client.callMusicu(
      'req_0',
      'music.recommend.RecommendFeed',
      'get_recommend_feed',
      { direction: 0, page: 1 },
      { cookie: true },
    )
    const shelf = asArray(at(json, 'req_0', 'data', 'v_shelf')).find(
      (item) => numberValue(asRecord(item).id) === QQ_FEED_SHELF_FOR_YOU,
    )
    if (!shelf) return null

    const seen = new Set<string>()
    const cards: UnifiedPlaylist[] = []
    for (const rawNiche of asArray(asRecord(shelf).v_niche)) {
      for (const rawCard of asArray(asRecord(rawNiche).v_card)) {
        const card = asRecord(rawCard)
        if (numberValue(card.type) !== QQ_FEED_CARD_TYPE_PLAYLIST) continue
        const id = stringValue(card.id)
        if (!id || seen.has(id)) continue
        seen.add(id)
        cards.push({
          provider: 'qq',
          type: 'playlist',
          id,
          name: QQ_FEED_SUBTYPE_LABELS[numberValue(card.subtype)] ?? stringValue(card.title),
          cover: stringValue(card.cover),
          trackCount: numberValue(card.cnt),
          tag: 'recommend',
        })
        if (cards.length >= limit) break
      }
      if (cards.length >= limit) break
    }

    if (cards.length < limit && !seen.has(QQ_MILLION_FAVORITES_DISSID)) {
      cards.push({
        provider: 'qq',
        type: 'playlist',
        id: QQ_MILLION_FAVORITES_DISSID,
        name: '百万收藏',
        cover: '',
        trackCount: 0,
        tag: 'recommend',
      })
    }
    if (!cards.length) return null

    // 缺名字或缺封面的卡回查一次歌单信息补齐（song_num=1，只要元数据不拉歌曲）
    const playlists = await Promise.all(
      cards.map(async (playlist) =>
        playlist.name && playlist.cover
          ? playlist
          : { ...playlist, ...(await this.dissMeta(String(playlist.id), playlist.name)) },
      ),
    )
    return {
      id: 'qq-recommend',
      title: stringValue(asRecord(shelf).title_content) || '为你推荐',
      playlists: playlists.filter((playlist) => Boolean(playlist.name)),
    }
  }

  /** 只取歌单的标题/封面/曲目数，不拉歌曲（song_num=1 是上游允许的最小值）。 */
  private async dissMeta(playlistId: string, keepName = ''): Promise<Partial<UnifiedPlaylist>> {
    try {
      const json = await this.client.callMusicu(
        'req_0',
        'music.srfDissInfo.aiDissInfo',
        'uniform_get_Dissinfo',
        { disstid: Number(playlistId) || playlistId, userinfo: 1, tag: 1, song_begin: 0, song_num: 1 },
        { cookie: true },
      )
      const data = at(json, 'req_0', 'data')
      const dirinfo = asRecord(field(data, 'dirinfo'))
      const cover = stringValue(asRecord(dirinfo.picurl).picurl ?? dirinfo.picurl ?? dirinfo.logo)
      return {
        // 固定叫法优先，别被歌单实名（常带用户昵称）覆盖
        name: keepName || stringValue(dirinfo.title),
        trackCount: numberValue(field(data, 'total_song_num')),
        ...(cover ? { cover } : {}),
      }
    } catch (error) {
      console.warn('[QQDiscover] 补歌单信息失败:', playlistId, errorMessage(error))
      return {}
    }
  }

  logout(): void {
    this.saveCookie('')
  }
}

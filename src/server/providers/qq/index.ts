import type { CredentialStore } from '../../types'
import type { LyricDoc, PlaybackRestriction, QQLoginInfo, SongUrlResult, UnifiedSong } from '@shared/models'
import { QQ_QUALITY_CANDIDATE_TEMPLATES, normalizeQualityPreference, qualityCandidatesFrom } from '@shared/models'
import { buildLyricLines } from '@shared/lyrics'
import { normalizeCookieHeader, rawCookieFallback } from '../../util/cookies'
import { QQClient, QQ_HEADERS, QQ_SMARTBOX_URL } from './client'
import { QQSession, normalizeQQCookieInput } from './session'
import {
  decodeQQLyricText,
  isQQFavoritePlaylist,
  isQzoneBackgroundPlaylist,
  mapQQComment,
  mapQQPlaylist,
  mapQQPlaylistTrack,
  mapQQSmartSong,
  mapQQTrack,
  normalizeQQSongId,
  qqSingerAvatar,
} from './mappers'
import { parseJSONText, requestText } from '../../util/http'

const QQ_LEGACY_VKEY_URL = 'https://c.y.qq.com/base/fcgi-bin/fcg_music_express_mobile3.fcg'
const QQ_TRIAL_DURATION_SECONDS = 30
const QQ_TRIAL_STREAM_ORIGIN = 'https://dl.stream.qqmusic.qq.com'

function playbackRestriction(
  category: PlaybackRestriction['category'],
  message: string,
  action: string,
  extra?: Record<string, unknown>,
): PlaybackRestriction {
  return { provider: 'qq', category, action, message, ...(extra || {}) }
}

export function classifyQQPlaybackRestriction(
  info: any,
  session: { hasSession: boolean; hasPlaybackKey: boolean },
): PlaybackRestriction {
  const hasSession = !!session.hasSession
  const hasPlaybackKey = !!session.hasPlaybackKey
  const rawMsg = String((info && (info.msg || info.tips || info.errmsg || info.message)) || '').trim()
  const code = Number((info && (info.result || info.code || info.errtype)) || 0)
  const lower = rawMsg.toLowerCase()
  if (!hasSession) {
    return playbackRestriction('login_required', 'QQ 音乐需要登录或授权后才能获取播放地址', 'login', {
      code,
      rawMessage: rawMsg,
    })
  }
  if (!hasPlaybackKey && code === 104003) {
    return playbackRestriction(
      'login_required',
      'QQ 音乐当前只拿到了网页登录状态，还缺少播放授权，请重新打开官方 QQ 音乐登录窗口完成授权',
      'login',
      { code, rawMessage: rawMsg, missingPlaybackKey: true },
    )
  }
  if (code === 104003) {
    return playbackRestriction(
      'copyright_unavailable',
      'QQ 音乐没有给当前版本返回播放地址，通常是版权、会员或官方版本限制，可以换一个搜索结果或切到网易云源',
      'switch_source',
      { code, rawMessage: rawMsg },
    )
  }
  if (/vip|会员|付费|购买|数字专辑|专辑|pay/.test(lower + rawMsg)) {
    return playbackRestriction('paid_required', 'QQ 音乐歌曲需要会员、购买或数字专辑权限', 'upgrade', {
      code,
      rawMessage: rawMsg,
    })
  }
  if (code && code !== 0) {
    return playbackRestriction('copyright_unavailable', rawMsg || 'QQ 音乐版权暂不可播或仅官方客户端可播', 'switch_source', {
      code,
      rawMessage: rawMsg,
    })
  }
  return playbackRestriction('url_unavailable', 'QQ 音乐没有返回播放地址，可能受版权、会员或官方客户端限制', 'switch_source', {
    code,
    rawMessage: rawMsg,
  })
}

export class QQProvider {
  readonly id = 'qq' as const
  private readonly client: QQClient

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
    this.credentials.set('qq', normalizeCookieHeader(raw) || rawCookieFallback(raw))
  }

  /** 校验并保存前端/登录窗口回填的 cookie；返回是否有效 */
  acceptCookieInput(raw: unknown): { ok: boolean; normalized: string } {
    const normalized = normalizeQQCookieInput(String(raw || ''))
    const session = new QQSession(normalized)
    if (!session.uin || !session.musicKey) return { ok: false, normalized }
    this.saveCookie(normalized)
    return { ok: true, normalized }
  }

  private profileFromBody(body: any, session: QQSession): QQLoginInfo {
    const uin = session.uin
    const data = (body && (body.data || body.profile || body.creator || body.result)) || {}
    const creator = data.creator || data.user || data.profile || data || {}
    const vipInfo = data.vipInfo || data.vipinfo || data.vip || creator.vipInfo || creator.vipinfo || {}
    const profileNick = creator.nick || creator.nickname || creator.name || creator.hostname || creator.title || ''
    const profileAvatar = creator.headpic || creator.avatar || creator.avatarUrl || creator.logo || ''
    const cookieNick = session.nickname()
    const nick = profileNick || cookieNick || ''
    const avatar = profileAvatar || session.avatar()
    let vipType =
      Number(
        session.obj.vipType ||
          session.obj.vip_type ||
          data.vipType ||
          data.vip_type ||
          data.viptype ||
          data.music_vip_level ||
          data.green_vip_level ||
          data.luxury_vip_level ||
          creator.vipType ||
          creator.vip_type ||
          creator.music_vip_level ||
          creator.green_vip_level ||
          creator.luxury_vip_level ||
          vipInfo.vipType ||
          vipInfo.vip_type ||
          vipInfo.music_vip_level ||
          vipInfo.green_vip_level ||
          vipInfo.luxury_vip_level ||
          0,
      ) || 0
    if (!vipType) {
      const vipFlag =
        data.isVip ||
        data.is_vip ||
        data.vipFlag ||
        data.vipflag ||
        creator.isVip ||
        creator.is_vip ||
        vipInfo.isVip ||
        vipInfo.is_vip ||
        vipInfo.vipFlag
      if (vipFlag === true || Number(vipFlag) > 0 || String(vipFlag || '').toLowerCase() === 'true') vipType = 1
    }
    return {
      provider: 'qq',
      loggedIn: !!(uin && session.musicKey),
      preview: false,
      userId: uin,
      nickname: nick || (uin ? 'QQ ' + uin : 'QQ 音乐'),
      avatar,
      vipType,
      hasCookie: !!this.cookie,
      playbackKeyReady: session.playbackReady,
      profileSource: profileNick || profileAvatar ? 'qq-profile' : cookieNick || avatar ? 'cookie' : 'fallback',
    }
  }

  async loginInfo(): Promise<QQLoginInfo> {
    const session = this.session
    if (!session.uin || !session.musicKey) return { provider: 'qq', loggedIn: false, hasCookie: !!this.cookie }
    const fallback = this.profileFromBody(null, session)
    try {
      const body = await this.client.getJSON(
        'https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg',
        {
          cid: '205360838',
          userid: session.uin,
          reqfrom: '1',
          g_tk: '5381',
          loginUin: session.uin,
          hostUin: '0',
          format: 'json',
          inCharset: 'utf8',
          outCharset: 'utf-8',
          notice: '0',
          platform: 'yqq.json',
          needNewCode: '0',
        },
      )
      const info = this.profileFromBody(body, session)
      if (body && (body.code === 1000 || body.result === 301)) {
        return { ...fallback, profileUnavailable: true }
      }
      return info
    } catch (e: any) {
      console.warn('[QQLogin] profile check failed:', e.message)
      return { ...fallback, profileUnavailable: true }
    }
  }

  async smartboxSearch(keywords: string, limit: number): Promise<UnifiedSong[]> {
    const u = new URL(QQ_SMARTBOX_URL)
    u.searchParams.set('format', 'json')
    u.searchParams.set('key', keywords)
    u.searchParams.set('g_tk', '5381')
    u.searchParams.set('loginUin', '0')
    u.searchParams.set('hostUin', '0')
    u.searchParams.set('inCharset', 'utf8')
    u.searchParams.set('outCharset', 'utf-8')
    u.searchParams.set('notice', '0')
    u.searchParams.set('platform', 'yqq.json')
    u.searchParams.set('needNewCode', '0')
    const text = await requestText(u.toString(), { headers: QQ_HEADERS })
    const json = parseJSONText(text)
    const items = json && json.data && json.data.song && json.data.song.itemlist
    return (Array.isArray(items) ? items : []).slice(0, Math.max(1, Math.min(limit || 6, 10))).map(mapQQSmartSong)
  }

  async songDetail(mid: string, fallback?: Partial<UnifiedSong>): Promise<UnifiedSong> {
    if (!mid) return fallback as UnifiedSong
    const json = await this.client.musicuRequest({
      comm: { ct: 24, cv: 0 },
      songinfo: {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail_yqq',
        param: { song_mid: mid },
      },
    })
    const data = json && json.songinfo && json.songinfo.data
    return mapQQTrack(data && data.track_info, fallback)
  }

  async search(keywords: string, limit: number): Promise<UnifiedSong[]> {
    const kw = String(keywords || '').trim()
    if (!kw) return []
    const base = await this.smartboxSearch(kw, limit)
    const detailed = await Promise.all(
      base.map(async (item) => {
        try {
          return await this.songDetail(item.mid || '', item)
        } catch (e: any) {
          console.warn('[QQSearch] detail failed:', item.mid, e.message)
          return item
        }
      }),
    )
    const seen = new Set<string>()
    return detailed.filter((song) => {
      const key = song && String(song.mid || song.id || song.name + '|' + song.artist)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return !!song.name
    })
  }

  /**
   * QQ 新式批量 vkey 在会员/版权受限时可能不给 purl；旧 mobile3 接口仍可能
   * 为 C400 AAC 返回服务端限制为 30 秒的试听 vkey。该请求固定以游客身份执行，
   * 只在完整地址失败后作为最后兜底，避免把试听误判为完整播放。
   */
  private async legacyTrialUrl(
    songmid: string,
    mediaIds: string[],
    guid: string,
    requestedQuality: string,
  ): Promise<SongUrlResult | null> {
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
        const items: any[] = body && body.data && Array.isArray(body.data.items) ? body.data.items : []
        const item = items.find((candidate) => candidate && candidate.vkey)
        const vkey = String((item && item.vkey) || '').trim()
        if (!vkey) continue

        const upstreamFilename = String((item && item.filename) || filename)
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
      } catch (err: any) {
        // 不记录请求 URL 或 vkey；只保留不敏感的候选名和错误摘要。
        console.warn('[QQSongUrl] trial vkey failed', {
          mid: songmid,
          filename,
          error: String((err && err.message) || err || 'UNKNOWN_ERROR'),
        })
      }
    }
    return null
  }

  async songUrl(mid: string, mediaMid: string, qualityPreference: string): Promise<SongUrlResult> {
    const songmid = String(mid || '').trim()
    if (!songmid) return { provider: 'qq', url: '', trial: false, playable: false, error: 'MISSING_MID', message: 'Missing QQ song mid' }
    const guid = String(10000000 + Math.floor(Math.random() * 90000000))
    const session = this.session
    const uin = session.uin || '0'
    const musicKey = session.musicKey
    const playbackKey = session.playbackKey
    const fileMediaMid = String(mediaMid || '').trim()
    const requestedQuality = normalizeQualityPreference(qualityPreference)
    const mediaIds: string[] = []
    if (fileMediaMid) mediaIds.push(fileMediaMid)
    if (songmid && !mediaIds.includes(songmid)) mediaIds.push(songmid)
    const fileCandidates = mediaIds.flatMap((mediaId) =>
      qualityCandidatesFrom(requestedQuality, QQ_QUALITY_CANDIDATE_TEMPLATES).map((item: any) => ({
        ...item,
        mediaId,
        filename: item.prefix + mediaId + item.ext,
      })),
    )
    const filenames = fileCandidates.map((item) => item.filename)
    const param: Record<string, any> = {
      guid,
      songmid: filenames.length ? filenames.map(() => songmid) : [songmid],
      songtype: filenames.length ? filenames.map(() => 0) : [0],
      uin,
      loginflag: 1,
      platform: '20',
    }
    if (filenames.length) param.filename = filenames
    const comm: Record<string, any> = { uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0 }
    if (musicKey) comm.authst = musicKey
    const json = await this.client.musicuRequest(
      {
        comm,
        req_0: {
          module: 'vkey.GetVkeyServer',
          method: 'CgiGetVkey',
          param,
        },
      },
      { cookie: true },
    )
    const data = json && json.req_0 && json.req_0.data
    const infos: any[] = data && Array.isArray(data.midurlinfo) ? data.midurlinfo : []
    const info = infos.find((item) => item && item.purl) || infos[0]
    const purl = info && info.purl
    if (purl) {
      const sip = (data.sip && data.sip[0]) || 'https://ws.stream.qqmusic.qq.com/'
      const fileMeta: any = fileCandidates.find((item) => item.filename === info.filename) || {}
      return {
        provider: 'qq',
        url: sip + purl,
        trial: false,
        playable: true,
        level: fileMeta.level || info.filename || '',
        quality: fileMeta.label || info.filename || '',
        filename: info.filename || '',
        requestedQuality,
      }
    }
    const trialFallback = await this.legacyTrialUrl(songmid, mediaIds, guid, requestedQuality)
    if (trialFallback) {
      return {
        ...trialFallback,
        loggedIn: !!(uin !== '0' && musicKey),
        playbackKeyReady: !!(uin !== '0' && playbackKey),
      }
    }

    const restriction = classifyQQPlaybackRestriction(info, {
      hasSession: !!(uin !== '0' && musicKey),
      hasPlaybackKey: !!(uin !== '0' && playbackKey),
    })
    // 取链失败是排障核心路径：把 QQ 返回码/原始消息/候选清单打到服务端控制台。
    // code/rawMessage 直接取 classifier 归一化结果（Number 归一保住合法的 0，链路含 info.message）
    console.warn('[QQSongUrl] no purl', {
      mid: songmid,
      requestedQuality,
      qqCode: restriction.code,
      rawMessage: restriction.rawMessage,
      category: restriction.category,
      playbackKeyReady: !!(uin !== '0' && playbackKey),
      tried: filenames.join(','),
    })
    return {
      provider: 'qq',
      url: '',
      trial: false,
      playable: false,
      error: 'QQ_URL_UNAVAILABLE',
      loggedIn: !!(uin !== '0' && musicKey),
      playbackKeyReady: !!(uin !== '0' && playbackKey),
      restriction,
      reason: restriction.category,
      message: restriction.message,
      qqCode: info && (info.result || info.code || info.errtype),
      rawMessage: info && (info.msg || info.tips || info.errmsg || ''),
      tried: fileCandidates.map((item: any) => item.label + ' · ' + item.filename),
      requestedQuality,
    }
  }

  async lyric(mid: string, id: string): Promise<LyricDoc> {
    const songMID = String(mid || '').trim()
    const songID = normalizeQQSongId(id)
    if (!songMID && !songID) return { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '', tlyric: '', yrc: '', lines: [], source: 'qq-empty' }

    let lyricText = ''
    let transText = ''
    let qrcText = ''
    let romaText = ''
    let source = 'qq-musicu'

    try {
      const param: Record<string, any> = {}
      if (songMID) param.songMID = songMID
      if (songID) param.songID = songID
      const json = await this.client.musicuRequest(
        {
          comm: { ct: 24, cv: 0 },
          lyric: {
            module: 'music.musichallSong.PlayLyricInfo',
            method: 'GetPlayLyricInfo',
            param,
          },
        },
        { cookie: true },
      )
      const data = json && json.lyric && json.lyric.data
      lyricText = decodeQQLyricText(data && data.lyric)
      transText = decodeQQLyricText(data && data.trans)
      qrcText = decodeQQLyricText(data && data.qrc)
      romaText = decodeQQLyricText(data && data.roma)
    } catch (e: any) {
      console.warn('[QQLyric] musicu failed:', e.message)
    }

    if (!lyricText && songMID) {
      try {
        const body = await this.client.getJSON(
          'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
          {
            songmid: songMID,
            songtype: '0',
            format: 'json',
            nobase64: '1',
            g_tk: '5381',
            loginUin: this.session.uin || '0',
            hostUin: '0',
            inCharset: 'utf8',
            outCharset: 'utf-8',
            notice: '0',
            platform: 'yqq.json',
            needNewCode: '0',
          },
          { headers: { Referer: 'https://y.qq.com/portal/player.html' } },
        )
        lyricText = decodeQQLyricText(body && body.lyric)
        transText = decodeQQLyricText(body && (body.trans || body.tlyric)) || transText
        source = 'qq-legacy'
      } catch (e: any) {
        console.warn('[QQLyric] legacy failed:', e.message)
      }
    }

    return {
      provider: 'qq',
      id: songID || '',
      mid: songMID,
      lyric: lyricText,
      tlyric: transText,
      yrc: '',
      lines: buildLyricLines({ lyric: lyricText, tlyric: transText, yrc: '' }),
      qrc: qrcText,
      roma: romaText,
      source: lyricText ? source : 'qq-empty',
    }
  }

  async userPlaylists(): Promise<any> {
    const info = await this.loginInfo()
    if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', playlists: [] }
    const uin = info.userId
    const createdReq = this.client.getJSON(
      'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss',
      {
        hostUin: 0,
        hostuin: uin,
        sin: 0,
        size: 200,
        g_tk: 5381,
        loginUin: uin,
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'yqq.json',
        needNewCode: 0,
      },
      { headers: { Referer: 'https://y.qq.com/portal/profile.html' } },
    )
    const collectReq = this.client.getJSON(
      'https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg',
      {
        ct: 20,
        cid: 205360956,
        userid: uin,
        reqtype: 3,
        sin: 0,
        ein: 80,
      },
      { headers: { Referer: 'https://y.qq.com/portal/profile.html' } },
    )
    const [createdRaw, collectRaw] = await Promise.allSettled([createdReq, collectReq])
    const created =
      createdRaw.status === 'fulfilled' && createdRaw.value && createdRaw.value.data && Array.isArray(createdRaw.value.data.disslist)
        ? createdRaw.value.data.disslist.map((pl: any) => mapQQPlaylist(pl, 'created'))
        : []
    const collected =
      collectRaw.status === 'fulfilled' && collectRaw.value && collectRaw.value.data && Array.isArray(collectRaw.value.data.cdlist)
        ? collectRaw.value.data.cdlist.map((pl: any) => mapQQPlaylist(pl, 'collect'))
        : []
    const seen = new Set<string>()
    const playlists = created
      .concat(collected)
      .filter((pl: any) => {
        if (!pl.id || !pl.name || seen.has(pl.id)) return false
        if (isQzoneBackgroundPlaylist(pl)) return false
        seen.add(pl.id)
        return true
      })
      .sort((a: any, b: any) => Number(isQQFavoritePlaylist(b)) - Number(isQQFavoritePlaylist(a)))
    return { loggedIn: true, provider: 'qq', userId: uin, playlists }
  }

  async likedTracks(offset: number, limit: number): Promise<any> {
    const info = await this.loginInfo()
    if (!info.loggedIn || !info.userId) {
      return {
        provider: 'qq',
        loggedIn: false,
        error: 'LOGIN_REQUIRED',
        message: '登录 QQ 音乐账号后才能读取喜欢的音乐',
        tracks: [],
      }
    }

    const playlistsResult = await this.userPlaylists()
    const likedPlaylist = ((playlistsResult && playlistsResult.playlists) || []).find(isQQFavoritePlaylist)
    if (!likedPlaylist || !likedPlaylist.id) {
      return {
        provider: 'qq',
        loggedIn: true,
        userId: info.userId,
        error: 'LIKED_TRACKS_UNAVAILABLE',
        message: 'QQ 音乐账号接口未返回“我喜欢”歌单，无法读取喜欢的音乐',
        tracks: [],
      }
    }

    const detail = await this.playlistTracks(String(likedPlaylist.id))
    if (detail && detail.error) {
      return {
        provider: 'qq',
        loggedIn: true,
        userId: info.userId,
        error: 'LIKED_TRACKS_UNAVAILABLE',
        message: String(detail.message || detail.error),
        tracks: [],
      }
    }

    const allTracks = Array.isArray(detail && detail.tracks) ? (detail.tracks as UnifiedSong[]) : []
    const safeOffset = Math.max(0, Math.floor(offset || 0))
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit || 100)))
    const tracks = allTracks.slice(safeOffset, safeOffset + safeLimit)
    return {
      provider: 'qq',
      loggedIn: true,
      userId: info.userId,
      playlist: detail.playlist || likedPlaylist,
      offset: safeOffset,
      limit: safeLimit,
      total: allTracks.length,
      hasMore: safeOffset + tracks.length < allTracks.length,
      tracks,
    }
  }

  async playlistTracks(id: string): Promise<any> {
    const info = await this.loginInfo()
    if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', tracks: [] }
    const pid = String(id || '').trim()
    if (!pid) return { loggedIn: true, provider: 'qq', error: 'Missing QQ playlist id', tracks: [] }
    const result = await this.client.getJSON(
      'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg',
      {
        type: 1,
        utf8: 1,
        disstid: pid,
        loginUin: info.userId,
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'yqq.json',
        needNewCode: 0,
      },
      { headers: { Referer: 'https://y.qq.com/n/yqq/playlist' } },
    )
    const detail = result && result.cdlist && result.cdlist[0] ? result.cdlist[0] : {}
    const rawTracks = Array.isArray(detail.songlist) ? detail.songlist : []
    const tracks = rawTracks.map(mapQQPlaylistTrack).filter((s: UnifiedSong) => s.name && (s.mid || s.id))
    const playlist = {
      provider: 'qq',
      id: pid,
      name: detail.dissname || detail.diss_name || detail.name || '',
      cover: detail.logo || detail.diss_cover || '',
      trackCount: tracks.length,
    }
    return { loggedIn: true, provider: 'qq', playlist, tracks }
  }

  async artistDetail(mid: string, limit: number): Promise<any> {
    const singerMid = String(mid || '').trim()
    const num = Math.max(10, Math.min(80, limit || 36))
    if (!singerMid) return { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] }
    const json = await this.client.musicuRequest(
      {
        comm: { ct: 24, cv: 0 },
        singer: {
          module: 'music.web_singer_info_svr',
          method: 'get_singer_detail_info',
          param: { sort: 5, singermid: singerMid, sin: 0, num },
        },
      },
      { cookie: true },
    )
    const block = json && json.singer
    if (!block || Number(block.code || 0) !== 0) {
      return {
        provider: 'qq',
        error: (block && (block.message || block.msg || block.code)) || 'QQ_ARTIST_DETAIL_FAILED',
        artist: null,
        songs: [],
      }
    }
    const data = block.data || {}
    const info = data.singer_info || data.singerInfo || {}
    const rawSongs = Array.isArray(data.songlist) ? data.songlist : []
    const songs = rawSongs
      .map((raw: any) => mapQQTrack((raw && (raw.track_info || raw.songInfo || raw.songinfo || raw.song)) || raw, {}))
      .filter((song: UnifiedSong) => song && song.name && (song.mid || song.id))
    const matchedSongArtist = songs[0] && (songs[0].artists || []).find((a: any) => a && a.mid === singerMid)
    const artistMid = info.mid || singerMid
    const artistName = info.name || info.title || (matchedSongArtist && matchedSongArtist.name) || ''
    const totalSong = Number(data.total_song || data.song_count || 0) || songs.length
    return {
      provider: 'qq',
      artist: {
        provider: 'qq',
        id: info.id || '',
        mid: artistMid,
        name: artistName,
        avatar: info.pic || info.avatar || qqSingerAvatar(artistMid, 300),
        fans: Number(info.fans || 0) || 0,
        musicSize: totalSong,
        albumSize: Number(data.total_album || 0) || 0,
        mvSize: Number(data.total_mv || 0) || 0,
      },
      total: totalSong,
      songs,
    }
  }

  async songComments(id: string, mid: string, limit: number, offset: number): Promise<any> {
    let topid = String(id || '').replace(/\D/g, '')
    if (!topid && mid) {
      try {
        const detail = await this.songDetail(mid, { mid })
        topid = String((detail && (detail.qqId || detail.id)) || '').replace(/\D/g, '')
      } catch (e: any) {
        console.warn('[QQComments] detail fallback failed:', e.message)
      }
    }
    if (!topid) return { provider: 'qq', error: 'Missing QQ song id', comments: [] }
    const page = Math.max(0, Math.floor((offset || 0) / Math.max(1, limit || 20)))
    const uin = this.session.uin || '0'
    const body = await this.client.getJSON(
      'https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg',
      {
        g_tk: '5381',
        loginUin: uin,
        hostUin: '0',
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq.json',
        needNewCode: '0',
        cid: '205360772',
        reqtype: '2',
        biztype: '1',
        topid,
        cmd: '8',
        needmusiccrit: '0',
        pagenum: String(page),
        pagesize: String(limit || 20),
      },
      { headers: { Referer: 'https://y.qq.com/n/ryqq/songDetail/' + encodeURIComponent(mid || topid) } },
    )
    const hotList = body && body.hot_comment && body.hot_comment.commentlist
    const normalList = body && body.comment && body.comment.commentlist
    const raw = offset === 0 && Array.isArray(hotList) && hotList.length ? hotList : normalList || []
    const comments = ((raw || []) as any[]).map(mapQQComment).filter((c) => c.content)
    const total = Number(body && body.comment && (body.comment.commenttotal || body.comment.comment_total)) || comments.length
    return { provider: 'qq', id: topid, total, comments, hot: !!(offset === 0 && Array.isArray(hotList) && hotList.length) }
  }

  logout(): void {
    this.saveCookie('')
  }
}

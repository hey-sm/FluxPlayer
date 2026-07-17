import type { MusicAuthResult, PlaylistListResult, PlaylistTracksResult } from '@shared/music-contract'
import type { LyricDoc, PlaybackRestriction, QQLoginInfo, UnifiedPlaylist, UnifiedSong } from '@shared/models'
import {
  QQ_QUALITY_CANDIDATE_TEMPLATES,
  normalizeQualityPreference,
  qualityCandidatesFrom,
} from '@shared/models'
import { buildLyricLines } from '@shared/lyrics'
import type { CredentialStore, ProviderLikedTracksResult, UpstreamPlaybackResource } from '../../types'
import { normalizeCookieHeader, rawCookieFallback } from '../../util/cookies'
import { parseJSONText, requestText } from '../../util/http'
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
import { QQClient, QQ_HEADERS, QQ_SMARTBOX_URL } from './client'
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
  action: string,
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
      'QQ 音乐没有给当前版本返回播放地址，通常是版权、会员或官方版本限制，可以换一个搜索结果或切到网易云源',
      'switch_source',
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
      'switch_source',
      {
        code,
        rawMessage,
      },
    )
  }
  return playbackRestriction(
    'url_unavailable',
    'QQ 音乐没有返回播放地址，可能受版权、会员或官方客户端限制',
    'switch_source',
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
    const session = this.session
    if (!session.uin || !session.musicKey) {
      return { provider: 'qq', loggedIn: false, hasCookie: Boolean(this.cookie) }
    }
    const fallback = this.profileFromBody(null, session)
    try {
      const body = await this.client.getJSON('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg', {
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
    const url = new URL(QQ_SMARTBOX_URL)
    const params = {
      format: 'json',
      key: keywords,
      g_tk: '5381',
      loginUin: '0',
      hostUin: '0',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq.json',
      needNewCode: '0',
    }
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const json = parseJSONText(await requestText(url.toString(), { headers: QQ_HEADERS }))
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
    const json = await this.client.musicuRequest({
      comm: { ct: 24, cv: 0 },
      songinfo: {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail_yqq',
        param: { song_mid: mid },
      },
    })
    return mapQQTrack(at(json, 'songinfo', 'data', 'track_info'), fallback)
  }

  async search(keywords: string, limit: number): Promise<UnifiedSong[]> {
    const normalized = String(keywords || '').trim()
    if (!normalized) return []
    const base = await this.smartboxSearch(normalized, limit)
    const detailed = await Promise.all(
      base.map(async (item) => {
        try {
          return await this.songDetail(item.mid || '', item)
        } catch (error) {
          console.warn('[QQSearch] detail failed:', item.mid, errorMessage(error))
          return item
        }
      }),
    )
    const seen = new Set<string>()
    return detailed.filter((song) => {
      const key = String(song.mid || song.id || `${song.name}|${song.artist}`)
      if (!key || seen.has(key) || !song.name) return false
      seen.add(key)
      return true
    })
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
    const comm: Record<string, unknown> = { uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0 }
    if (musicKey) comm.authst = musicKey

    const json = await this.client.musicuRequest(
      {
        comm,
        req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param },
      },
      { cookie: true },
    )
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
        if (!id || !playlist.name || seen.has(id) || isQzoneBackgroundPlaylist(playlist)) return false
        seen.add(id)
        return true
      })
      .sort((left, right) => Number(isQQFavoritePlaylist(right)) - Number(isQQFavoritePlaylist(left)))
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

  async playlistTracks(id: string): Promise<PlaylistTracksResult> {
    const info = await this.loginInfo()
    if (!info.loggedIn || !info.userId) return { provider: 'qq', loggedIn: false, playlist: null, tracks: [] }
    const playlistId = String(id || '').trim()
    if (!playlistId) return { provider: 'qq', loggedIn: true, playlist: null, tracks: [] }
    const result = await this.client.getJSON(
      'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg',
      {
        type: 1,
        utf8: 1,
        disstid: playlistId,
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
    return { provider: 'qq', loggedIn: true, playlist, tracks }
  }

  logout(): void {
    this.saveCookie('')
  }
}

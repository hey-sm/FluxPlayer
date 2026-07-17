import type { MusicAuthResult, PlaylistListResult, PlaylistTracksResult } from '@shared/music-contract'
import type {
  LyricDoc,
  NeteaseLoginInfo,
  PlaybackRestriction,
  UnifiedArtist,
  UnifiedPlaylist,
  UnifiedSong,
} from '@shared/models'
import { NETEASE_QUALITY_CANDIDATES, normalizeQualityPreference, qualityCandidatesFrom } from '@shared/models'
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
  identifier,
  numberValue,
  optionalString,
  stringValue,
} from '../../util/unknown'
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
  return { provider: 'netease', category, action, message, ...(extra ?? {}) }
}

export function classifyNeteasePlaybackRestriction(
  lastData: unknown,
  loginInfo: unknown,
): PlaybackRestriction {
  const loggedIn = booleanValue(field(loginInfo, 'loggedIn'))
  const fee = numberValue(field(lastData, 'fee'))
  const code = numberValue(field(lastData, 'code'))
  const freeTrial = field(lastData, 'freeTrialInfo')
  if (!loggedIn) {
    return playbackRestriction('login_required', '网易云需要登录后尝试获取完整播放地址', 'login', {
      code,
      fee,
    })
  }
  if (freeTrial) {
    return playbackRestriction('trial_only', '网易云仅返回试听片段，完整播放需要会员或购买', 'upgrade', {
      code,
      fee,
    })
  }
  if (fee === 1) {
    return playbackRestriction(
      'vip_required',
      '网易云歌曲需要 VIP 权限，当前无法获取完整播放地址',
      'upgrade',
      { code, fee },
    )
  }
  if (fee === 4 || fee === 8) {
    return playbackRestriction('paid_required', '网易云歌曲需要单曲、专辑购买或更高权限', 'purchase', {
      code,
      fee,
    })
  }
  if (code === 404 || code === 403) {
    return playbackRestriction(
      'copyright_unavailable',
      '网易云版权暂不可播，换源或稍后重试会更稳',
      'switch_source',
      {
        code,
        fee,
      },
    )
  }
  return playbackRestriction(
    'url_unavailable',
    '网易云没有返回可播放地址，可能是版权、会员或地区限制',
    loggedIn ? 'switch_source' : 'login',
    { code, fee },
  )
}

export function mapArtists(raw: unknown): UnifiedArtist[] {
  return asArray(raw)
    .map((value): UnifiedArtist => {
      const artist = asRecord(value)
      return {
        id: identifier(artist.id),
        name: stringValue(artist.name),
      }
    })
    .filter((artist) => Boolean(artist.name))
}

export function mapSongRecord(raw: unknown): UnifiedSong {
  const song = asRecord(raw)
  const artists = mapArtists(song.ar ?? song.artists)
  const album = asRecord(song.al ?? song.album)
  const id = identifier(song.id) ?? ''
  return {
    provider: 'netease',
    type: 'song',
    id,
    name: stringValue(song.name),
    artist: artists.map((artist) => artist.name).join(' / '),
    artists,
    artistId: artists[0]?.id,
    album: stringValue(album.name),
    cover: stringValue(album.picUrl ?? album.coverUrl),
    duration: numberValue(song.dt ?? song.duration),
    fee: song.fee === undefined ? undefined : numberValue(song.fee),
  }
}

export function readCookieFromResponse(response: unknown): string {
  const candidates = [
    field(response, 'cookie'),
    at(response, 'body', 'cookie'),
    at(response, 'body', 'data', 'cookie'),
    at(response, 'body', 'data', 'cookies'),
  ]
  for (const candidate of candidates) {
    const cookie = normalizeCookieHeader(candidate)
    if (cookie) return cookie
  }
  return ''
}

function normalizeApiCode(payload: unknown): number {
  const body = field(payload, 'body') ?? payload
  return numberValue(field(body, 'code') ?? at(body, 'body', 'code') ?? field(payload, 'status'))
}

function normalizeApiMessage(payload: unknown): string {
  const body = field(payload, 'body') ?? payload
  return stringValue(
    field(body, 'message') ??
      field(body, 'msg') ??
      field(body, 'error') ??
      at(body, 'body', 'message') ??
      at(body, 'body', 'msg') ??
      at(body, 'body', 'error'),
  )
}

function normalizeVip(profileValue: unknown, accountValue: unknown, extraValue: unknown) {
  const profile = asRecord(profileValue)
  const account = asRecord(accountValue)
  const extra = asRecord(extraValue)
  const vipType = numberValue(profile.vipType ?? account.vipType ?? extra.vipType)
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

export function normalizeLoginInfo(
  profileValue: unknown,
  accountValue: unknown,
  extraValue?: unknown,
): NeteaseLoginInfo {
  const profile = asRecord(profileValue)
  const account = asRecord(accountValue)
  const userId = identifier(profile.userId ?? profile.user_id ?? profile.id ?? account.userId ?? account.id)
  if (userId === undefined) return { ...EMPTY_LOGIN }
  return {
    loggedIn: true,
    userId,
    nickname: stringValue(profile.nickname ?? profile.userName, '网易云用户'),
    avatar: stringValue(profile.avatarUrl ?? profile.avatar),
    ...normalizeVip(profile, account, extraValue),
  }
}

function isAuthInvalidPayload(payload: unknown): boolean {
  const code = normalizeApiCode(payload)
  if (code === 301 || code === 401) return true
  return /未登录|需要登录|请先登录|login/i.test(normalizeApiMessage(payload)) && code >= 300
}

function mapPlaylist(raw: unknown): UnifiedPlaylist {
  const playlist = asRecord(raw)
  const creator = asRecord(playlist.creator)
  return {
    provider: 'netease',
    type: 'playlist',
    id: identifier(playlist.id) ?? '',
    name: stringValue(playlist.name),
    cover: stringValue(playlist.coverImgUrl ?? playlist.cover),
    trackCount: numberValue(playlist.trackCount),
    playCount: numberValue(playlist.playCount),
    creator: stringValue(creator.nickname),
    subscribed: booleanValue(playlist.subscribed),
    specialType: numberValue(playlist.specialType),
  }
}

function toAuthResult(info: NeteaseLoginInfo): MusicAuthResult {
  return {
    provider: 'netease',
    loggedIn: info.loggedIn,
    userId: info.userId,
    nickname: info.nickname,
    avatar: info.avatar,
    vipType: info.vipType,
    vipLevel: info.vipLevel,
    isVip: info.isVip,
    isSvip: info.isSvip,
    vipLabel: info.vipLabel,
    hasCookie: info.hasCookie,
    pendingProfile: info.pendingProfile,
  }
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

  acceptCredential(raw: unknown): boolean {
    const normalized = normalizeCookieHeader(raw) || rawCookieFallback(raw)
    if (!normalized) return false
    this.credentials.set('netease', normalized)
    return true
  }

  hasSvip(info: NeteaseLoginInfo): boolean {
    return Boolean(
      info.loggedIn && (info.vipLevel === 'svip' || info.isSvip || Number(info.vipType || 0) >= 10),
    )
  }

  async loginInfo(): Promise<NeteaseLoginInfo> {
    const cookie = this.cookie
    if (!cookie) return { ...EMPTY_LOGIN }

    try {
      const status = await ncm.login_status({ cookie, timestamp: Date.now() })
      const body = asRecord(status.body)
      const data = asRecord(body.data ?? body)
      const info = normalizeLoginInfo(data.profile ?? body.profile, data.account ?? body.account, data)
      if (info.loggedIn) return info
    } catch (error) {
      console.warn('[NeteaseAuth] login_status failed:', errorMessage(error))
    }

    try {
      const account = await ncm.user_account({ cookie, timestamp: Date.now() })
      const body = asRecord(account.body)
      const info = normalizeLoginInfo(body.profile, body.account, body)
      if (info.loggedIn) return info
      if (isAuthInvalidPayload(account)) this.saveCookie('')
      return { ...EMPTY_LOGIN, hasCookie: Boolean(this.cookie) }
    } catch (error) {
      console.warn('[NeteaseAuth] user_account failed:', errorMessage(error))
      return { ...EMPTY_LOGIN, hasCookie: Boolean(this.cookie) }
    }
  }

  async authStatus(): Promise<MusicAuthResult> {
    return toAuthResult(await this.loginInfo())
  }

  async search(keywords: string, limit: number): Promise<UnifiedSong[]> {
    const result = await ncm.cloudsearch({ keywords, limit, cookie: this.cookie })
    const songs = asArray(at(result.body, 'result', 'songs'))
    let mapped = songs.map(mapSongRecord).filter((song) => song.id !== '' && song.name)

    const missing = mapped.filter((song) => !song.cover).map((song) => song.id)
    if (missing.length) {
      try {
        const details = await ncm.song_detail({ ids: missing.join(','), cookie: this.cookie })
        const covers = new Map<string, string>()
        for (const raw of asArray(at(details.body, 'songs'))) {
          const id = identifier(field(raw, 'id'))
          const cover = stringValue(at(raw, 'al', 'picUrl') ?? at(raw, 'album', 'picUrl'))
          if (id !== undefined && cover) covers.set(String(id), cover)
        }
        mapped = mapped.map((song) =>
          song.cover ? song : { ...song, cover: covers.get(String(song.id)) ?? '' },
        )
      } catch (error) {
        console.warn('[NeteaseSearch] cover backfill failed:', errorMessage(error))
      }
    }
    return mapped
  }

  async songUrl(
    id: string,
    loginInfo: NeteaseLoginInfo,
    qualityPreference: string,
  ): Promise<UpstreamPlaybackResource> {
    const requestedQuality = normalizeQualityPreference(qualityPreference)
    const qualities = qualityCandidatesFrom(requestedQuality, NETEASE_QUALITY_CANDIDATES).filter(
      (quality) => !('svip' in quality) || !quality.svip || this.hasSvip(loginInfo),
    )

    let trialFallback: UpstreamPlaybackResource | null = null
    let lastData: unknown
    let lastError: unknown

    for (const quality of qualities) {
      try {
        let result: NcmResponse
        try {
          result = await ncm.song_url_v1({ id, level: quality.level, cookie: this.cookie })
        } catch {
          result = await ncm.song_url({ id, br: quality.br, cookie: this.cookie })
        }
        const data = asArray(at(result.body, 'data'))[0]
        if (data) lastData = data
        const url = optionalString(field(data, 'url'))
        const freeTrial = field(data, 'freeTrialInfo')
        if (url && !freeTrial) {
          return {
            provider: 'netease',
            url,
            headers: {},
            trial: false,
            playable: true,
            level: quality.level,
            quality: quality.label,
            br: numberValue(field(data, 'br')) || undefined,
            requestedQuality,
          }
        }
        if (url && freeTrial && !trialFallback) {
          const restriction = {
            ...classifyNeteasePlaybackRestriction(data, loginInfo),
            duration: 30,
          }
          trialFallback = {
            provider: 'netease',
            url,
            headers: {},
            trial: true,
            playable: true,
            level: quality.level,
            quality: quality.label,
            br: numberValue(field(data, 'br')) || undefined,
            requestedQuality,
            trialInfo: { start: 0, end: 30, duration: 30, source: 'netease-free-trial' },
            restriction,
            reason: restriction.category,
            message: restriction.message,
          }
        }
      } catch (error) {
        lastError = error
      }
    }

    if (trialFallback) return trialFallback
    const restriction = classifyNeteasePlaybackRestriction(lastData, loginInfo)
    const diagnostics = {
      code: numberValue(field(lastData, 'code')) || undefined,
      fee: numberValue(field(lastData, 'fee')) || undefined,
      upstreamError: lastError ? errorMessage(lastError) : undefined,
    }
    console.warn('[NeteasePlayback] no URL', {
      id,
      requestedQuality,
      category: restriction.category,
      ...diagnostics,
    })
    return {
      provider: 'netease',
      url: null,
      headers: {},
      trial: false,
      playable: false,
      requestedQuality,
      restriction,
      reason: restriction.category,
      message: restriction.message,
      diagnostics,
    }
  }

  async resolvePlayback(song: UnifiedSong, quality: string): Promise<UpstreamPlaybackResource> {
    const loginInfo = await this.loginInfo()
    return this.songUrl(String(song.id), loginInfo, quality)
  }

  async getLyrics(id: string | number, _mid?: string): Promise<LyricDoc> {
    return this.lyric(String(id))
  }

  async lyric(id: string): Promise<LyricDoc> {
    let body: unknown = {}
    let source = 'lyric'
    try {
      const modern = await ncm.lyric_new({ id, cookie: this.cookie, timestamp: Date.now() })
      body = modern.body ?? {}
      source = 'lyric_new'
    } catch (error) {
      console.warn('[NeteaseLyrics] lyric_new failed:', errorMessage(error))
    }

    if (!stringValue(at(body, 'lrc', 'lyric')) && !stringValue(at(body, 'yrc', 'lyric'))) {
      const legacy = await ncm.lyric({ id, cookie: this.cookie, timestamp: Date.now() })
      body = legacy.body ?? body
      source = 'lyric'
    }
    const lyric = stringValue(at(body, 'lrc', 'lyric'))
    const tlyric = stringValue(at(body, 'tlyric', 'lyric'))
    const yrc = stringValue(at(body, 'yrc', 'lyric'))
    return { lyric, tlyric, yrc, lines: buildLyricLines({ lyric, tlyric, yrc }), source }
  }

  async userPlaylists(limit: number): Promise<PlaylistListResult> {
    const info = await this.loginInfo()
    if (!info.loggedIn || info.userId === undefined) {
      return { provider: 'netease', loggedIn: false, playlists: [] }
    }
    const result = await ncm.user_playlist({
      uid: info.userId,
      limit,
      cookie: this.cookie,
      timestamp: Date.now(),
    })
    return {
      provider: 'netease',
      loggedIn: true,
      identity: String(info.userId),
      playlists: asArray(at(result.body, 'playlist'))
        .map(mapPlaylist)
        .filter((playlist) => Boolean(playlist.id && playlist.name)),
    }
  }

  async likedTracks(offset: number, limit: number): Promise<ProviderLikedTracksResult> {
    const safeOffset = Math.max(0, Math.floor(offset || 0))
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit || 100)))
    const info = await this.loginInfo()
    if (!info.loggedIn || info.userId === undefined) {
      return {
        provider: 'netease',
        loggedIn: false,
        tracks: [],
        offset: safeOffset,
        limit: safeLimit,
        total: 0,
        hasMore: false,
        error: 'LOGIN_REQUIRED',
        message: '登录网易云账号后才能读取喜欢的音乐',
      }
    }

    const liked = await ncm.likelist({ uid: info.userId, cookie: this.cookie, timestamp: Date.now() })
    const ids = Array.from(
      new Set(
        asArray(at(liked.body, 'ids'))
          .map((id) => stringValue(id).trim())
          .filter(Boolean),
      ),
    )
    const pageIds = ids.slice(safeOffset, safeOffset + safeLimit)
    const rawTracks: unknown[] = []
    for (let start = 0; start < pageIds.length; start += 100) {
      const chunk = pageIds.slice(start, start + 100)
      const detail = await ncm.song_detail({
        ids: chunk.join(','),
        cookie: this.cookie,
        timestamp: Date.now(),
      })
      rawTracks.push(...asArray(at(detail.body, 'songs')))
    }

    const byId = new Map(
      rawTracks
        .map(mapSongRecord)
        .filter((track) => track.id !== '' && track.name)
        .map((track) => [String(track.id), track] as const),
    )
    const tracks = pageIds
      .map((id) => byId.get(id))
      .filter((track): track is UnifiedSong => track !== undefined)
    return {
      provider: 'netease',
      loggedIn: true,
      identity: String(info.userId),
      tracks,
      offset: safeOffset,
      limit: safeLimit,
      total: ids.length,
      hasMore: safeOffset + pageIds.length < ids.length,
    }
  }

  async playlistTracks(id: string): Promise<PlaylistTracksResult> {
    let playlist: UnifiedPlaylist = {
      provider: 'netease',
      type: 'playlist',
      id,
      name: '',
      cover: '',
      trackCount: 0,
    }
    let rawTracks: unknown[] = []

    try {
      const all = await ncm.playlist_track_all({
        id,
        limit: 500,
        offset: 0,
        cookie: this.cookie,
        timestamp: Date.now(),
      })
      rawTracks = asArray(at(all.body, 'songs')).concat(asArray(at(all.body, 'tracks')))
    } catch (error) {
      console.warn('[NeteasePlaylist] playlist_track_all failed:', errorMessage(error))
    }

    if (!rawTracks.length) {
      const detail = await ncm.playlist_detail({ id, s: 0, cookie: this.cookie, timestamp: Date.now() })
      const rawPlaylist = at(detail.body, 'playlist')
      playlist = mapPlaylist({ ...asRecord(rawPlaylist), id: identifier(field(rawPlaylist, 'id')) ?? id })
      rawTracks = asArray(field(rawPlaylist, 'tracks'))
    }

    const tracks = rawTracks.map(mapSongRecord).filter((track) => track.id !== '' && track.name)
    if (!playlist.trackCount) playlist = { ...playlist, trackCount: tracks.length }
    return { provider: 'netease', playlist, tracks }
  }

  async logout(): Promise<void> {
    try {
      await ncm.logout({ cookie: this.cookie })
    } catch {
      // Credentials are still cleared locally when upstream logout is unavailable.
    }
    this.saveCookie('')
  }
}

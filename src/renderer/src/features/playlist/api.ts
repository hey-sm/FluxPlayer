import type { ProviderId, UnifiedPlaylist, UnifiedSong } from '@shared/models'
import { apiJson } from '../../api'

export interface PlaylistListResult {
  provider: ProviderId
  loggedIn: boolean
  identity?: string
  playlists: UnifiedPlaylist[]
}

export interface PlaylistTracksResult {
  provider: ProviderId
  loggedIn?: boolean
  playlist: UnifiedPlaylist | null
  tracks: UnifiedSong[]
}

type RecordLike = Record<string, unknown>
const object = (value: unknown): RecordLike =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordLike) : {}
const text = (value: unknown): string => (value == null ? '' : String(value))
const number = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const arrayAt = (root: RecordLike, ...keys: string[]): unknown[] => {
  for (const key of keys) if (Array.isArray(root[key])) return root[key] as unknown[]
  return []
}

export function normalizePlaylist(raw: unknown, provider: ProviderId): UnifiedPlaylist | null {
  const value = object(raw)
  const id = value.id ?? value.disstid ?? value.dissid ?? value.playlistId
  const name = text(value.name ?? value.dissname ?? value.diss_name ?? value.title)
  if (id === undefined || id === null || id === '' || !name) return null
  const creatorValue = object(value.creator)
  return {
    provider,
    source: provider,
    type: text(value.type) || 'playlist',
    id: id as string | number,
    name,
    cover: text(value.cover ?? value.coverImgUrl ?? value.logo ?? value.diss_cover),
    trackCount: number(value.trackCount ?? value.songnum ?? value.songCount ?? value.total),
    playCount: number(value.playCount ?? value.visitnum),
    creator: text(value.creatorName ?? creatorValue.nickname ?? creatorValue.name ?? value.creator),
    subscribed: Boolean(value.subscribed),
    specialType: number(value.specialType),
    tag: text(value.tag),
  }
}

export function normalizeSong(raw: unknown, provider: ProviderId): UnifiedSong | null {
  const value = object(raw)
  const id = value.id ?? value.mid ?? value.songmid ?? value.songId
  const name = text(value.name ?? value.songname ?? value.title)
  if (id === undefined || id === null || id === '' || !name) return null
  const rawArtists = Array.isArray(value.artists)
    ? value.artists
    : Array.isArray(value.ar)
      ? value.ar
      : Array.isArray(value.singer)
        ? value.singer
        : []
  const artists = rawArtists
    .map((item) => {
      const artist = object(item)
      return {
        id: artist.id as string | number | undefined,
        mid: text(artist.mid) || undefined,
        name: text(artist.name ?? artist.title),
      }
    })
    .filter((artist) => artist.name)
  const album = object(value.al ?? value.album)
  const artistText =
    text(value.artist ?? value.singername) || artists.map((artist) => artist.name).join(' / ')
  const durationRaw = number(value.duration ?? value.dt ?? value.interval)
  return {
    provider,
    source: provider,
    type: text(value.type) || 'song',
    id: id as string | number,
    name,
    artist: artistText,
    artists: artists.length ? artists : artistText ? [{ name: artistText }] : [],
    artistId: value.artistId as string | number | undefined,
    album: text(value.albumName ?? album.name ?? value.album),
    cover: text(value.cover ?? value.picUrl ?? album.picUrl),
    duration:
      value.interval !== undefined && value.duration === undefined && value.dt === undefined
        ? durationRaw * 1000
        : durationRaw,
    fee: value.fee === undefined ? undefined : number(value.fee),
    qqId: value.qqId as string | number | undefined,
    mid: text(value.mid) || undefined,
    songmid: text(value.songmid ?? value.mid) || undefined,
    mediaMid: text(value.mediaMid ?? value.strMediaMid) || undefined,
    artistMid: text(value.artistMid) || undefined,
    albumMid: text(value.albumMid) || undefined,
    playable: typeof value.playable === 'boolean' ? value.playable : undefined,
  }
}

export function normalizePlaylistListResponse(raw: unknown, provider: ProviderId): PlaylistListResult {
  const root = object(raw)
  const data = object(root.data)
  const list = arrayAt(root, 'playlists', 'playlist', 'list').length
    ? arrayAt(root, 'playlists', 'playlist', 'list')
    : arrayAt(data, 'playlists', 'playlist', 'list', 'disslist', 'cdlist')
  return {
    provider,
    loggedIn: root.loggedIn === undefined ? true : Boolean(root.loggedIn),
    identity: text(root.userId ?? root.uid ?? data.userId) || undefined,
    playlists: list
      .map((item) => normalizePlaylist(item, provider))
      .filter((item): item is UnifiedPlaylist => item !== null),
  }
}

export function normalizePlaylistTracksResponse(raw: unknown, provider: ProviderId): PlaylistTracksResult {
  const root = object(raw)
  const data = object(root.data)
  const list = arrayAt(root, 'tracks', 'songs', 'songlist').length
    ? arrayAt(root, 'tracks', 'songs', 'songlist')
    : arrayAt(data, 'tracks', 'songs', 'songlist')
  return {
    provider,
    loggedIn: root.loggedIn === undefined ? undefined : Boolean(root.loggedIn),
    playlist: normalizePlaylist(root.playlist ?? data.playlist, provider),
    tracks: list
      .map((item) => normalizeSong(item, provider))
      .filter((item): item is UnifiedSong => item !== null),
  }
}

export async function fetchPlaylists(provider: ProviderId, limit = 60): Promise<PlaylistListResult> {
  const path =
    provider === 'qq'
      ? '/api/qq/user/playlists'
      : `/api/user/playlists?limit=${Math.max(1, Math.floor(limit))}`
  return normalizePlaylistListResponse(await apiJson<unknown>(path), provider)
}

export async function fetchPlaylistTracks(
  provider: ProviderId,
  id: string | number,
): Promise<PlaylistTracksResult> {
  const prefix = provider === 'qq' ? '/api/qq/playlist/tracks' : '/api/playlist/tracks'
  return normalizePlaylistTracksResponse(
    await apiJson<unknown>(`${prefix}?id=${encodeURIComponent(String(id))}`),
    provider,
  )
}

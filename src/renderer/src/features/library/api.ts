import type { ProviderId, UnifiedSong } from '@shared/models'
import { apiJson } from '../../api'
import { normalizeSong } from '../playlist/api'
import { normalizePageRequest, type PageRequest } from './pagination'

export interface LikedTracksResult {
  provider: ProviderId
  loggedIn: boolean
  identity?: string
  tracks: UnifiedSong[]
  offset: number
  limit: number
  total: number
  hasMore: boolean
}

type RecordLike = Record<string, unknown>
const object = (value: unknown): RecordLike =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordLike) : {}
const finiteNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function normalizeLikedTracksResponse(
  raw: unknown,
  provider: ProviderId,
  request: PageRequest = {},
): LikedTracksResult {
  const root = object(raw)
  const data = object(root.data)
  const page = normalizePageRequest(request)
  const rawTracks = Array.isArray(root.tracks)
    ? root.tracks
    : Array.isArray(root.songs)
      ? root.songs
      : Array.isArray(data.tracks)
        ? data.tracks
        : []
  const tracks = rawTracks
    .map((track) => normalizeSong(track, provider))
    .filter((track): track is UnifiedSong => track !== null)
  const offset = Math.max(0, Math.floor(finiteNumber(root.offset, page.offset)))
  const limit = Math.max(1, Math.floor(finiteNumber(root.limit, page.limit)))
  const total = Math.max(tracks.length, Math.floor(finiteNumber(root.total, offset + tracks.length)))
  return {
    provider,
    loggedIn: root.loggedIn === undefined ? true : Boolean(root.loggedIn),
    identity: String(root.userId ?? root.uid ?? data.userId ?? '').trim() || undefined,
    tracks,
    offset,
    limit,
    total,
    hasMore: root.hasMore === undefined ? offset + tracks.length < total : Boolean(root.hasMore),
  }
}

export async function fetchLikedTracks(
  provider: ProviderId,
  request: PageRequest = {},
): Promise<LikedTracksResult> {
  const page = normalizePageRequest(request)
  const prefix = provider === 'qq' ? '/api/qq/user/liked/tracks' : '/api/user/liked/tracks'
  const path = `${prefix}?offset=${page.offset}&limit=${page.limit}`
  return normalizeLikedTracksResponse(await apiJson<unknown>(path), provider, page)
}

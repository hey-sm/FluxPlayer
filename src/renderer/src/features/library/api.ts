import type { ProviderId } from '@shared/models'
import type { LikedTracksResult } from '@shared/music-contract'
import { getLikedTracks } from '../../api'
import { normalizePageRequest, type PageRequest } from './pagination'

export type { LikedTracksResult }

export function fetchLikedTracks(
  provider: ProviderId,
  request: PageRequest = {},
  signal?: AbortSignal,
): Promise<LikedTracksResult> {
  const page = normalizePageRequest(request)
  return getLikedTracks({ provider, ...page }, signal)
}

/** IPC 契约把单次 limit 夹在 200，超过 200 首的「我喜欢」必须翻页拉全，否则会被静默截断。 */
const LIKED_PAGE_SIZE = 200
const LIKED_MAX_PAGES = 25

export async function fetchAllLikedTracks(
  provider: ProviderId,
  signal?: AbortSignal,
): Promise<LikedTracksResult> {
  const first = await fetchLikedTracks(provider, { offset: 0, limit: LIKED_PAGE_SIZE }, signal)
  if (!first.hasMore) return first

  const tracks = [...first.tracks]
  for (let page = 1; page < LIKED_MAX_PAGES; page += 1) {
    const next = await fetchLikedTracks(
      provider,
      { offset: page * LIKED_PAGE_SIZE, limit: LIKED_PAGE_SIZE },
      signal,
    )
    tracks.push(...next.tracks)
    if (!next.hasMore || next.tracks.length === 0) break
  }
  return { ...first, tracks, limit: tracks.length, hasMore: false }
}

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

import type { ProviderId } from '@shared/models'
import type { DiscoverResult } from '@shared/music-contract'
import { abortable, musicClient } from '../../api'

export type { DiscoverResult }

export function fetchDiscover(
  provider: ProviderId,
  limit: number,
  signal?: AbortSignal,
): Promise<DiscoverResult> {
  return abortable(musicClient.getDiscover({ provider, limit }), signal)
}

import type { QueryFunctionContext } from '@tanstack/react-query'
import type { ProviderId } from '@shared/models'
import { fetchDiscover } from './api'

/** 推荐是个性化的，缓存 key 必须带 identity —— 换账号不能读到上一个账号的推荐。 */
export const DISCOVER_STALE_TIME = 30 * 60 * 1000
/** 官方推荐行就是三个位置（每日30首 / 新歌推荐 / 百万收藏），一行正好放下 */
export const DISCOVER_LIMIT = 3

export const discoverQueryKey = (provider: ProviderId, identityToken: string, limit: number) =>
  ['discover', provider, identityToken, limit] as const

export function createDiscoverQuery(
  provider: ProviderId,
  identityToken: string,
  limit: number = DISCOVER_LIMIT,
): {
  queryKey: ReturnType<typeof discoverQueryKey>
  queryFn(
    context: QueryFunctionContext<ReturnType<typeof discoverQueryKey>>,
  ): ReturnType<typeof fetchDiscover>
} {
  return {
    queryKey: discoverQueryKey(provider, identityToken, limit),
    queryFn: ({ signal }) => fetchDiscover(provider, limit, signal),
  }
}

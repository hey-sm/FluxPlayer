import type { QueryFunctionContext } from '@tanstack/react-query'
import type { ProviderId } from '@shared/models'
import type { MusicSearchResult } from '@shared/music-contract'
import { searchMusic } from '../../api'

export const searchQueryKey = (provider: ProviderId, keywords: string) =>
  ['search', provider, keywords] as const

/**
 * 无限滚动搜索。上游不回总数，getNextPageParam 靠 hasMore（本页是否拿满 limit）推断，
 * 因此最后一页之后会多打一次空请求就停 —— 用换取"不需要总数"的简单性。
 */
export function createSearchQuery(
  provider: ProviderId,
  keywords: string,
  limit: number,
): {
  queryKey: ReturnType<typeof searchQueryKey>
  queryFn(
    context: QueryFunctionContext<ReturnType<typeof searchQueryKey>, number>,
  ): ReturnType<typeof searchMusic>
  initialPageParam: number
  getNextPageParam(lastPage: MusicSearchResult): number | undefined
} {
  return {
    queryKey: searchQueryKey(provider, keywords),
    queryFn: ({ signal, pageParam }) => searchMusic({ provider, keywords, limit, page: pageParam }, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  }
}

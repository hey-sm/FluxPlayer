import type { QueryFunctionContext } from '@tanstack/react-query'
import type { ProviderId } from '@shared/models'
import { searchMusic } from '../../api'

export const searchQueryKey = (provider: ProviderId, keywords: string) =>
  ['search', provider, keywords] as const

export function createSearchQuery(
  provider: ProviderId,
  keywords: string,
  limit: number,
): {
  queryKey: ReturnType<typeof searchQueryKey>
  queryFn(context: QueryFunctionContext<ReturnType<typeof searchQueryKey>>): ReturnType<typeof searchMusic>
} {
  return {
    queryKey: searchQueryKey(provider, keywords),
    queryFn: ({ signal }) => searchMusic({ provider, keywords, limit }, signal),
  }
}

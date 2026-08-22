import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MusicSearchResult, MusicSearchRequest } from '@shared/music-contract'
import type { UnifiedSong } from '@shared/models'

const searchMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/api', () => ({
  searchMusic: searchMock,
}))

import { createSearchQuery } from '@renderer/features/search/queries'

const song = (id: string, name: string): UnifiedSong => ({
  provider: 'netease',
  type: 'song',
  id,
  name,
  artist: 'Artist',
  artists: [{ name: 'Artist' }],
  album: 'Album',
  cover: '',
  duration: 180_000,
})

interface PendingSearch {
  readonly request: MusicSearchRequest
  readonly signal: AbortSignal
  resolve(result: MusicSearchResult): void
  reject(error: unknown): void
}

let pending: PendingSearch[]

beforeEach(() => {
  pending = []
  searchMock.mockReset().mockImplementation(
    (request: MusicSearchRequest, signal: AbortSignal) =>
      new Promise<MusicSearchResult>((resolve, reject) => {
        pending.push({ request, signal, resolve, reject })
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted', 'AbortError')),
          { once: true },
        )
      }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('search query cancellation', () => {
  it('aborts the stale query when a live observer switches keywords and publishes only the latest result', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
    })
    // 生产侧 SearchPanel 用的是 useInfiniteQuery，所以这里必须用 InfiniteQueryObserver，
    // 否则测的是一条真实代码不会走的路径。
    const observer = new InfiniteQueryObserver(queryClient, {
      ...createSearchQuery('netease', 'first', 20),
      retry: false,
    })
    const results: Array<InfiniteData<MusicSearchResult> | undefined> = []
    const unsubscribe = observer.subscribe((result) => results.push(result.data))

    await vi.waitFor(() => expect(pending).toHaveLength(1))
    // initialPageParam 为 1，首页请求必须带上 page —— 这是生产 useInfiniteQuery 的真实行为。
    expect(pending[0].request).toEqual({ provider: 'netease', keywords: 'first', limit: 20, page: 1 })

    observer.setOptions({
      ...createSearchQuery('netease', 'second', 20),
      retry: false,
    })

    await vi.waitFor(() => {
      expect(pending).toHaveLength(2)
      expect(pending[0].signal.aborted).toBe(true)
    })

    const latest: MusicSearchResult = {
      provider: 'netease',
      songs: [song('second-song', 'Second result')],
      page: 1,
      hasMore: false,
    }
    pending[1].resolve(latest)

    await vi.waitFor(() => expect(observer.getCurrentResult().data?.pages).toEqual([latest]))
    expect(observer.getCurrentResult().data?.pages[0]?.songs[0]?.name).toBe('Second result')
    expect(results.filter((data) => data !== undefined).map((data) => data.pages)).toEqual([[latest]])

    unsubscribe()
    queryClient.clear()
  })
})

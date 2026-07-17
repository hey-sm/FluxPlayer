import { QueryClient, QueryObserver } from '@tanstack/react-query'
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
    const observer = new QueryObserver(queryClient, {
      ...createSearchQuery('netease', 'first', 20),
      retry: false,
    })
    const results: Array<MusicSearchResult | undefined> = []
    const unsubscribe = observer.subscribe((result) => results.push(result.data))

    await vi.waitFor(() => expect(pending).toHaveLength(1))
    expect(pending[0].request).toEqual({ provider: 'netease', keywords: 'first', limit: 20 })

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
    }
    pending[1].resolve(latest)

    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(latest))
    expect(observer.getCurrentResult().data?.songs[0]?.name).toBe('Second result')
    expect(results.filter(Boolean)).toEqual([latest])

    unsubscribe()
    queryClient.clear()
  })
})

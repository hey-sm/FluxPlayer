import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LikedTracksResult } from '@shared/music-contract'
import type { UnifiedSong } from '@shared/models'
import { fetchLikedTracks } from '@renderer/features/library/api'
import { normalizePageRequest, slicePage } from '@renderer/features/library/pagination'
import { libraryQueryKeys } from '@renderer/features/library/queries'
import { RecentPlaybackStore, recentPlaybackStorageKey } from '@renderer/features/library/recent'
import { calculateWindow } from '@renderer/features/library/window'
import { getLikedTracks } from '@renderer/api'

const apiMock = vi.hoisted(() => ({
  getLikedTracks: vi.fn(),
}))

vi.mock('@renderer/api', () => ({
  getLikedTracks: apiMock.getLikedTracks,
}))

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function track(provider: 'netease' | 'qq', id: string | number, name = `Track ${id}`): UnifiedSong {
  return {
    provider,
    type: 'song',
    id,
    name,
    artist: 'Artist',
    artists: [{ name: 'Artist' }],
    album: 'Album',
    cover: '',
    duration: 1000,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  apiMock.getLikedTracks.mockReset()
})

describe('library pagination and query contracts', () => {
  it('normalizes reusable page requests and slices without mutating the source', () => {
    const source = [0, 1, 2, 3, 4]
    expect(normalizePageRequest({ offset: -5, limit: 999 })).toEqual({ offset: 0, limit: 200 })
    expect(slicePage(source, { offset: 2, limit: 2 })).toEqual({
      offset: 2,
      limit: 2,
      items: [2, 3],
      total: 5,
      hasMore: true,
    })
    expect(source).toEqual([0, 1, 2, 3, 4])
  })

  it('isolates liked and recent caches by provider and identity', () => {
    expect(libraryQueryKeys.liked('netease', 'user:1', { offset: 0, limit: 50 })).not.toEqual(
      libraryQueryKeys.liked('qq', 'user:1', { offset: 0, limit: 50 }),
    )
    expect(libraryQueryKeys.recent('qq', 'guest')).not.toEqual(libraryQueryKeys.recent('qq', 'user:1'))
  })

  it('keeps fixed-row windowing reusable for all library track collections', () => {
    expect(calculateWindow(500, 56 * 200, 560, 56, 5)).toEqual({
      start: 195,
      end: 215,
      offsetTop: 10920,
      offsetBottom: 15960,
    })
  })
})

describe('typed liked-tracks client', () => {
  it('sends a bounded typed request and forwards the AbortSignal', async () => {
    const controller = new AbortController()
    const result: LikedTracksResult = {
      provider: 'qq',
      loggedIn: true,
      identity: '9',
      tracks: [],
      offset: 3,
      limit: 200,
      total: 0,
      hasMore: false,
    }
    apiMock.getLikedTracks.mockResolvedValue(result)

    await expect(fetchLikedTracks('qq', { offset: 3, limit: 999 }, controller.signal)).resolves.toBe(result)

    expect(getLikedTracks).toHaveBeenCalledOnce()
    expect(getLikedTracks).toHaveBeenCalledWith({ provider: 'qq', offset: 3, limit: 200 }, controller.signal)
  })

  it('returns the strict IPC result unchanged', async () => {
    const result: LikedTracksResult = {
      provider: 'netease',
      loggedIn: true,
      identity: '7',
      tracks: [track('netease', 1)],
      offset: 0,
      limit: 50,
      total: 1,
      hasMore: false,
    }
    apiMock.getLikedTracks.mockResolvedValue(result)

    const received = await fetchLikedTracks('netease', { offset: 0, limit: 50 })

    expect(received).toBe(result)
    expect(received).toEqual(result)
    expect(received.tracks[0]).toEqual(track('netease', 1))
  })
})

describe('recent playback persistence', () => {
  it('isolates provider + user/guest scopes, deduplicates and moves the newest track first', () => {
    const storage = new MemoryStorage()
    const store = new RecentPlaybackStore(storage)
    const qqGuest = { provider: 'qq' as const }
    const qqUser = { provider: 'qq' as const, userId: '42' }
    const neteaseGuest = { provider: 'netease' as const }

    store.record(qqGuest, track('qq', 'a'), 1)
    store.record(qqGuest, track('qq', 'b'), 2)
    store.record(qqGuest, track('qq', 'a', 'Updated'), 3)
    store.record(qqUser, track('qq', 'u'), 4)
    store.record(neteaseGuest, track('netease', 1), 5)

    expect(store.read(qqGuest).map((entry) => [entry.track.id, entry.track.name, entry.playedAt])).toEqual([
      ['a', 'Updated', 3],
      ['b', 'Track b', 2],
    ])
    expect(store.read(qqUser).map((entry) => entry.track.id)).toEqual(['u'])
    expect(store.read(neteaseGuest).map((entry) => entry.track.id)).toEqual([1])
    expect(recentPlaybackStorageKey(qqGuest)).not.toBe(recentPlaybackStorageKey(qqUser))
  })

  it('persists at most 200 entries and restores strict tracks in a fresh store', () => {
    const storage = new MemoryStorage()
    const identity = { provider: 'netease' as const, userId: 7 }
    const writer = new RecentPlaybackStore(storage)
    for (let id = 0; id < 205; id += 1) writer.record(identity, track('netease', id), id)

    const restored = new RecentPlaybackStore(storage).read(identity)
    expect(restored).toHaveLength(200)
    expect(restored[0]).toMatchObject({ playedAt: 204, track: { id: 204, provider: 'netease' } })
    expect(restored.at(-1)).toMatchObject({ playedAt: 5, track: { id: 5 } })
  })

  it('notifies only the subscribed identity and supports idempotent unsubscribe', () => {
    const store = new RecentPlaybackStore(new MemoryStorage())
    const identity = { provider: 'qq' as const, userId: '1' }
    const listener = vi.fn()
    const unsubscribe = store.subscribe(identity, listener)

    store.record({ provider: 'qq', userId: '2' }, track('qq', 'other'))
    store.record(identity, track('qq', 'mine'), 10)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0][0]).toMatchObject({ playedAt: 10, track: { id: 'mine' } })

    unsubscribe()
    unsubscribe()
    store.record(identity, track('qq', 'next'))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('rejects cross-provider records and safely ignores corrupt persistence', () => {
    const storage = new MemoryStorage()
    const identity = { provider: 'qq' as const }
    storage.setItem(recentPlaybackStorageKey(identity), '{bad json')
    const store = new RecentPlaybackStore(storage)

    expect(store.read(identity)).toEqual([])
    expect(() => store.record(identity, track('netease', 1))).toThrow('RECENT_TRACK_PROVIDER_MISMATCH')
  })
})

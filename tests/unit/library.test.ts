import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnifiedSong } from '@shared/models'
import {
  fetchLikedTracks,
  libraryQueryKeys,
  normalizeLikedTracksResponse,
  normalizePageRequest,
  RecentPlaybackStore,
  recentPlaybackStorageKey,
  slicePage,
} from '@renderer/features/library'
import { calculateWindow } from '@renderer/features/library/window'
import { NeteaseProvider } from '@server/providers/netease'
import { QQProvider } from '@server/providers/qq'

const ncmMock = vi.hoisted(() => ({
  likelist: vi.fn(),
  song_detail: vi.fn(),
}))

vi.mock('@server/providers/netease/sdk', () => ({ ncm: ncmMock }))

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const credentials = {
  get: vi.fn(() => 'cookie'),
  set: vi.fn(),
}

function track(provider: 'netease' | 'qq', id: string | number, name = `Track ${id}`): UnifiedSong {
  return {
    provider,
    source: provider,
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
  ncmMock.likelist.mockReset()
  ncmMock.song_detail.mockReset()
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
    expect(libraryQueryKeys.recent('qq', 'guest')).not.toEqual(
      libraryQueryKeys.recent('qq', 'user:1'),
    )
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

describe('liked tracks client', () => {
  it('normalizes platform aliases and page metadata', () => {
    const result = normalizeLikedTracksResponse(
      {
        loggedIn: true,
        userId: 9,
        offset: 20,
        limit: 2,
        total: 23,
        songs: [
          { id: 1, name: 'N', artist: 'A', duration: 1000 },
          { songmid: 'q2', songname: 'Q', singer: [{ name: 'Singer' }], interval: 9 },
        ],
      },
      'qq',
    )
    expect(result).toMatchObject({ identity: '9', offset: 20, limit: 2, total: 23, hasMore: true })
    expect(result.tracks).toHaveLength(2)
    expect(result.tracks[1]).toMatchObject({ id: 'q2', provider: 'qq', duration: 9000 })
  })

  it('calls the real provider-specific route with a bounded page', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ loggedIn: true, tracks: [], total: 0, offset: 3, limit: 200 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchLikedTracks('qq', { offset: 3, limit: 999 })

    expect(fetchMock).toHaveBeenCalledWith('/api/qq/user/liked/tracks?offset=3&limit=200', undefined)
    vi.unstubAllGlobals()
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

  it('persists at most 200 entries and restores them in a fresh store', () => {
    const storage = new MemoryStorage()
    const identity = { provider: 'netease' as const, userId: 7 }
    const writer = new RecentPlaybackStore(storage)
    for (let id = 0; id < 205; id += 1) writer.record(identity, track('netease', id), id)

    const restored = new RecentPlaybackStore(storage).read(identity)
    expect(restored).toHaveLength(200)
    expect(restored[0]).toMatchObject({ playedAt: 204, track: { id: 204 } })
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

describe('real liked-track provider adapters', () => {
  it('loads Netease liked ids through likelist + song_detail and preserves platform order', async () => {
    ncmMock.likelist.mockResolvedValue({ body: { ids: [3, 2, 1] } })
    ncmMock.song_detail.mockResolvedValue({
      body: {
        songs: [
          { id: 1, name: 'One', ar: [{ name: 'A' }], al: {} },
          { id: 3, name: 'Three', ar: [{ name: 'A' }], al: {} },
        ],
      },
    })
    const provider = new NeteaseProvider(credentials)
    vi.spyOn(provider, 'loginInfo').mockResolvedValue({
      loggedIn: true,
      userId: 7,
      vipType: 0,
      vipLevel: 'none',
      isVip: false,
      isSvip: false,
      vipLabel: '无VIP',
    })

    const result = await provider.likedTracks(0, 2)

    expect(ncmMock.likelist).toHaveBeenCalled()
    expect(ncmMock.song_detail).toHaveBeenCalledWith(expect.objectContaining({ ids: '3,2' }))
    expect(result.tracks.map((item: UnifiedSong) => item.id)).toEqual([3])
    expect(result).toMatchObject({ total: 3, offset: 0, limit: 2, hasMore: true })
  })

  it('uses the QQ account favorite playlist and returns an explicit unavailable error when absent', async () => {
    const provider = new QQProvider(credentials)
    vi.spyOn(provider, 'loginInfo').mockResolvedValue({ provider: 'qq', loggedIn: true, userId: '42' })
    vi.spyOn(provider, 'userPlaylists').mockResolvedValue({
      loggedIn: true,
      playlists: [{ id: 'liked', name: '我喜欢', cover: '', trackCount: 2 }],
    })
    vi.spyOn(provider, 'playlistTracks').mockResolvedValue({
      playlist: { id: 'liked', name: '我喜欢' },
      tracks: [track('qq', 'a'), track('qq', 'b')],
    })

    await expect(provider.likedTracks(1, 1)).resolves.toMatchObject({
      total: 2,
      offset: 1,
      limit: 1,
      hasMore: false,
      tracks: [{ id: 'b' }],
    })

    vi.mocked(provider.userPlaylists).mockResolvedValue({ loggedIn: true, playlists: [] })
    await expect(provider.likedTracks(0, 20)).resolves.toMatchObject({
      error: 'LIKED_TRACKS_UNAVAILABLE',
      tracks: [],
    })
  })
})

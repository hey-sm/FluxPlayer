import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnifiedSong } from '@shared/models'
import { makeSong } from '../helpers/song'

vi.mock('@renderer/api', () => ({
  apiJson: vi.fn(),
  audioProxyUrl: (url: string) => `proxy:${url}`,
  apiUrl: (path: string) => path,
  coverProxyUrl: (url: string) => url,
}))

class FakeAudio extends EventTarget {
  static playScript: (src: string) => Promise<void> = () => Promise.resolve()
  src = ''
  volume = 1
  preload = ''
  currentTime = 0
  duration = Number.NaN
  paused = true

  play(): Promise<void> {
    this.paused = false
    return FakeAudio.playScript(this.src)
  }

  pause(): void {
    this.paused = true
  }

  load(): void {}
}

function song(id: number, provider: UnifiedSong['provider'] = 'netease'): UnifiedSong {
  return makeSong({
    provider,
    source: provider,
    id,
    mid: provider === 'qq' ? `MID${id}` : undefined,
    mediaMid: provider === 'qq' ? `MEDIA${id}` : undefined,
    name: `歌曲${id}`,
    artist: '测试歌手',
    artists: [{ name: '测试歌手' }],
    duration: 180000,
  })
}

let usePlayer: (typeof import('@renderer/stores/player'))['usePlayer']
let apiJson: ReturnType<typeof vi.fn>

async function importFreshPlayer(): Promise<void> {
  vi.resetModules()
  const api = await import('@renderer/api')
  apiJson = vi.mocked(api.apiJson) as unknown as ReturnType<typeof vi.fn>
  apiJson.mockReset()
  ;({ usePlayer } = await import('@renderer/stores/player'))
}

function mockPlayableUrls(): void {
  apiJson.mockImplementation(async (path: string) => ({
    provider: path.startsWith('/api/qq/') ? 'qq' : 'netease',
    url: `https://audio.test/${encodeURIComponent(path)}.mp3`,
    playable: true,
    trial: false,
    level: 'exhigh',
    quality: '320k MP3',
  }))
}

beforeEach(async () => {
  vi.unstubAllGlobals()
  vi.stubGlobal('Audio', FakeAudio)
  FakeAudio.playScript = () => Promise.resolve()
  await importFreshPlayer()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('player queue API and modes', () => {
  it('uses setQueue as the official API and keeps playList as a compatibility alias', async () => {
    mockPlayableUrls()
    const firstQueue = [song(1), song(2)]
    await usePlayer.getState().setQueue(firstQueue, 1)

    expect(usePlayer.getState().queue).not.toBe(firstQueue)
    expect(usePlayer.getState().current?.id).toBe(2)
    expect(usePlayer.getState().mode).toBe('sequence')

    await usePlayer.getState().playList([song(3), song(4)], 0)
    expect(usePlayer.getState().queue.map((item) => item.id)).toEqual([3, 4])
    expect(usePlayer.getState().current?.id).toBe(3)
  })

  it('sequence loops at the queue ends; repeat-one only repeats natural ended', async () => {
    mockPlayableUrls()
    const audio = usePlayer.getState().audio

    await usePlayer.getState().setQueue([song(1), song(2)], 0)
    audio.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => {
      expect(usePlayer.getState().current?.id).toBe(2)
      expect(usePlayer.getState().status).toBe('playing')
    })
    audio.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => {
      expect(usePlayer.getState().current?.id).toBe(1)
      expect(usePlayer.getState().status).toBe('playing')
    })

    usePlayer.getState().setMode('repeat-one')
    const callsBeforeRepeat = apiJson.mock.calls.length
    audio.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(apiJson.mock.calls.length).toBe(callsBeforeRepeat + 1))
    expect(usePlayer.getState().current?.id).toBe(1)

    await usePlayer.getState().next()
    expect(usePlayer.getState().current?.id).toBe(2)
    await usePlayer.getState().next()
    expect(usePlayer.getState().current?.id).toBe(1)
    await usePlayer.getState().prev()
    expect(usePlayer.getState().current?.id).toBe(2)
  })

  it('replays a one-song queue through ended, next, and prev', async () => {
    mockPlayableUrls()
    const audio = usePlayer.getState().audio
    await usePlayer.getState().setQueue([song(7)], 0)
    const initialCalls = apiJson.mock.calls.length

    await usePlayer.getState().next()
    await usePlayer.getState().prev()
    audio.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => {
      expect(apiJson.mock.calls.length).toBe(initialCalls + 3)
      expect(usePlayer.getState().status).toBe('playing')
    })
    expect(usePlayer.getState().current?.id).toBe(7)
  })

  it('shuffle visits every queue item once per round and prev/next walk generated history', async () => {
    mockPlayableUrls()
    usePlayer.getState().setMode('shuffle')
    await usePlayer.getState().setQueue([song(1), song(2), song(3), song(4), song(5)], 2)

    await usePlayer.getState().prev()
    expect(usePlayer.getState().current?.id).not.toBe(3)
    await usePlayer.getState().next()
    expect(usePlayer.getState().current?.id).toBe(3)

    const visited = [Number(usePlayer.getState().current?.id)]
    for (let step = 0; step < 4; step += 1) {
      await usePlayer.getState().next()
      visited.push(Number(usePlayer.getState().current?.id))
    }
    expect(new Set(visited).size).toBe(5)
    expect(new Set(visited)).toEqual(new Set([1, 2, 3, 4, 5]))

    await usePlayer.getState().prev()
    expect(usePlayer.getState().current?.id).toBe(visited[3])
    await usePlayer.getState().prev()
    expect(usePlayer.getState().current?.id).toBe(visited[2])
    await usePlayer.getState().next()
    expect(usePlayer.getState().current?.id).toBe(visited[3])
  })

  it('shuffle ended follows its deck and replacing the queue rebuilds stale shuffle indices', async () => {
    mockPlayableUrls()
    usePlayer.getState().setMode('shuffle')
    await usePlayer.getState().setQueue([song(1), song(2), song(3)], 0)
    const audio = usePlayer.getState().audio
    const visited = [Number(usePlayer.getState().current?.id)]

    for (let step = 0; step < 2; step += 1) {
      const previous = usePlayer.getState().current?.id
      audio.dispatchEvent(new Event('ended'))
      await vi.waitFor(() => {
        expect(usePlayer.getState().current?.id).not.toBe(previous)
        expect(usePlayer.getState().status).toBe('playing')
      })
      visited.push(Number(usePlayer.getState().current?.id))
    }
    expect(new Set(visited).size).toBe(3)

    await usePlayer.getState().setQueue([song(10), song(11)], 1)
    expect(usePlayer.getState().current?.id).toBe(11)
    await usePlayer.getState().next()
    expect(usePlayer.getState().current?.id).toBe(10)
    expect(usePlayer.getState().queue.map((item) => item.id)).toEqual([10, 11])
  })
})

describe('player volume persistence', () => {
  it('defaults to 0.8 without browser storage and for invalid persisted values', async () => {
    expect(usePlayer.getState().volume).toBe(0.8)
    expect(usePlayer.getState().audio.volume).toBe(0.8)

    const storage = {
      getItem: vi.fn(() => 'not-a-volume'),
      setItem: vi.fn(),
    } as unknown as Storage
    vi.stubGlobal('window', { localStorage: storage })
    await importFreshPlayer()

    expect(usePlayer.getState().volume).toBe(0.8)
    expect(usePlayer.getState().audio.volume).toBe(0.8)
  })

  it('repairs muted/current legacy persisted values while runtime zero remains keyboard-adjustable', async () => {
    const values = new Map<string, string>([
      ['fluxplayer-volume-v1', '0'],
      ['apex-player-volume', '35%'],
    ])
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    } as unknown as Storage
    vi.stubGlobal('window', { localStorage: storage })
    await importFreshPlayer()

    expect(usePlayer.getState().volume).toBe(0.35)
    expect(values.get('fluxplayer-volume-v1')).toBe('0.35')

    usePlayer.getState().setVolume(0)
    expect(usePlayer.getState().audio.volume).toBe(0)
    usePlayer.getState().setVolume(usePlayer.getState().volume + 0.05)
    expect(usePlayer.getState().volume).toBe(0.05)
  })

  it('persists volume and restores it in a fresh store', async () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    } as unknown as Storage
    vi.stubGlobal('window', { localStorage: storage })
    await importFreshPlayer()

    usePlayer.getState().setVolume(0.35)
    expect(storage.setItem).toHaveBeenCalledWith('fluxplayer-volume-v1', '0.35')
    expect(usePlayer.getState().audio.volume).toBe(0.35)

    await importFreshPlayer()
    expect(usePlayer.getState().volume).toBe(0.35)
    expect(usePlayer.getState().audio.volume).toBe(0.35)
  })
})

describe('explicit alternate-source retry', () => {
  it('replaces the failed item with a matching alternate and plays it', async () => {
    const original = song(1, 'netease')
    const alternate = song(101, 'qq')
    alternate.name = original.name
    FakeAudio.playScript = (src) =>
      src.includes('original.mp3') ? Promise.reject(new Error('原始音源解码失败')) : Promise.resolve()
    apiJson.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/song/url')) {
        return { provider: 'netease', url: 'https://audio.test/original.mp3', playable: true, trial: false }
      }
      if (path.startsWith('/api/qq/search')) return { songs: [alternate] }
      if (path.startsWith('/api/qq/song/url')) {
        return { provider: 'qq', url: 'https://audio.test/alternate.mp3', playable: true, trial: false }
      }
      throw new Error(`unexpected: ${path}`)
    })

    await usePlayer.getState().setQueue([original], 0)
    expect(usePlayer.getState().message).toContain('原始音源解码失败')
    await usePlayer.getState().retryWithAlternateSource()

    expect(usePlayer.getState().status).toBe('playing')
    expect(usePlayer.getState().current?.provider).toBe('qq')
    expect(usePlayer.getState().queue[0]?.id).toBe(101)
    expect(apiJson.mock.calls.filter(([path]) => String(path).startsWith('/api/qq/search'))).toHaveLength(1)
  })

  it('keeps a readable alternate failure reason and never recursively searches back', async () => {
    const original = song(1, 'netease')
    const alternate = song(101, 'qq')
    alternate.name = original.name
    FakeAudio.playScript = () => Promise.reject(new Error('原始音源解码失败'))
    apiJson.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/song/url')) {
        return { provider: 'netease', url: 'https://audio.test/original.mp3', playable: true, trial: false }
      }
      if (path.startsWith('/api/qq/search')) return { songs: [alternate] }
      if (path.startsWith('/api/qq/song/url')) {
        return {
          provider: 'qq',
          url: '',
          playable: false,
          trial: false,
          reason: 'copyright_unavailable',
          message: '备用源版权受限',
        }
      }
      throw new Error(`unexpected: ${path}`)
    })

    await usePlayer.getState().setQueue([original], 0)
    await usePlayer.getState().retryWithAlternateSource()

    expect(usePlayer.getState().status).toBe('error')
    expect(usePlayer.getState().message).toContain('备用源版权受限')
    expect(apiJson.mock.calls.filter(([path]) => String(path).includes('/search'))).toHaveLength(1)
  })
})

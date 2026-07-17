import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FluxMusicApi } from '@shared/music-contract'
import type { ProviderId, UnifiedSong } from '@shared/models'
import { makeSong } from '../helpers/song'

vi.mock('@renderer/api', () => ({
  musicClient: {
    resolvePlayback: vi.fn(),
    search: vi.fn(),
  },
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

function song(id: number, provider: ProviderId = 'netease'): UnifiedSong {
  return makeSong({
    provider,
    id,
    mid: provider === 'qq' ? `MID${id}` : undefined,
    mediaMid: provider === 'qq' ? `MEDIA${id}` : undefined,
    name: `歌曲${id}`,
    artist: '测试歌手',
    artists: [{ name: '测试歌手' }],
    duration: 180_000,
  })
}

let usePlayer: (typeof import('@renderer/stores/player'))['usePlayer']
let resolvePlayback: ReturnType<typeof vi.fn<FluxMusicApi['resolvePlayback']>>

async function importFreshPlayer(): Promise<void> {
  vi.resetModules()
  const { musicClient } = await import('@renderer/api')
  resolvePlayback = vi.mocked(musicClient.resolvePlayback)
  resolvePlayback.mockReset()
  resolvePlayback.mockImplementation(async ({ song: requestedSong, quality }) => ({
    provider: requestedSong.provider,
    url: `flux-media://audio/${requestedSong.provider}-${requestedSong.id}-${quality}`,
    playable: true,
    trial: false,
    level: quality,
    quality,
  }))
  ;({ usePlayer } = await import('@renderer/stores/player'))
}

beforeEach(async () => {
  vi.unstubAllGlobals()
  vi.stubGlobal('Audio', FakeAudio)
  FakeAudio.playScript = () => Promise.resolve()
  await importFreshPlayer()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PlaybackEngine queue modes', () => {
  it('uses setQueue as the only queue replacement API and clamps the start index', async () => {
    const firstQueue = [song(1), song(2)]
    await usePlayer.getState().setQueue(firstQueue, 99)

    expect(usePlayer.getState().queue).not.toBe(firstQueue)
    expect(usePlayer.getState().queue.map((item) => item.id)).toEqual([1, 2])
    expect(usePlayer.getState()).toMatchObject({ index: 1, current: firstQueue[1], mode: 'sequence' })

    const replacement = [song(3), song(4)]
    await usePlayer.getState().setQueue(replacement, -3)
    expect(usePlayer.getState()).toMatchObject({ index: 0, current: replacement[0], status: 'playing' })
    expect(usePlayer.getState().queue.map((item) => item.id)).toEqual([3, 4])
  })

  it('sequence wraps at both queue ends and advances on a natural ended event', async () => {
    const queue = [song(1), song(2)]
    const audio = usePlayer.getState().audio
    await usePlayer.getState().setQueue(queue, 0)

    await usePlayer.getState().prev()
    expect(usePlayer.getState().current).toBe(queue[1])
    await usePlayer.getState().next()
    expect(usePlayer.getState().current).toBe(queue[0])

    audio.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => {
      expect(usePlayer.getState()).toMatchObject({ current: queue[1], status: 'playing' })
    })
    audio.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => {
      expect(usePlayer.getState()).toMatchObject({ current: queue[0], status: 'playing' })
    })
  })

  it('repeat-one repeats only natural completion while explicit next and prev still navigate', async () => {
    const queue = [song(1), song(2)]
    const audio = usePlayer.getState().audio
    await usePlayer.getState().setQueue(queue, 0)
    usePlayer.getState().setMode('repeat-one')

    const callsBeforeEnded = resolvePlayback.mock.calls.length
    audio.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(resolvePlayback).toHaveBeenCalledTimes(callsBeforeEnded + 1))
    expect(usePlayer.getState().current).toBe(queue[0])

    await usePlayer.getState().next()
    expect(usePlayer.getState().current).toBe(queue[1])
    await usePlayer.getState().prev()
    expect(usePlayer.getState().current).toBe(queue[0])
  })

  it('shuffle visits every item once per round and prev/next walk the generated history', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const queue = [song(1), song(2), song(3), song(4), song(5)]
    usePlayer.getState().setMode('shuffle')
    await usePlayer.getState().setQueue(queue, 2)

    const visited = [usePlayer.getState().current?.id]
    for (let step = 0; step < queue.length - 1; step += 1) {
      await usePlayer.getState().next()
      visited.push(usePlayer.getState().current?.id)
    }
    expect(new Set(visited)).toEqual(new Set([1, 2, 3, 4, 5]))

    const last = usePlayer.getState().current
    await usePlayer.getState().prev()
    const previous = usePlayer.getState().current
    expect(previous).not.toBe(last)
    await usePlayer.getState().next()
    expect(usePlayer.getState().current).toBe(last)
  })

  it('replays a one-song queue through ended, next, and prev', async () => {
    const only = song(7)
    const audio = usePlayer.getState().audio
    await usePlayer.getState().setQueue([only], 0)
    const initialCalls = resolvePlayback.mock.calls.length

    await usePlayer.getState().next()
    await usePlayer.getState().prev()
    audio.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => {
      expect(resolvePlayback).toHaveBeenCalledTimes(initialCalls + 3)
      expect(usePlayer.getState()).toMatchObject({ current: only, status: 'playing' })
    })
  })

  it('clears playback state when setQueue receives an empty queue', async () => {
    await usePlayer.getState().setQueue([song(1)], 0)
    await usePlayer.getState().setQueue([], 0)

    expect(usePlayer.getState()).toMatchObject({
      queue: [],
      index: -1,
      current: null,
      status: 'idle',
      message: '',
    })
    expect(usePlayer.getState().audio.src).toBe('')
  })
})

describe('PlaybackEngine volume persistence', () => {
  it('defaults to 0.8 when the current volume key is absent or invalid', async () => {
    expect(usePlayer.getState().volume).toBe(0.8)
    expect(usePlayer.getState().audio.volume).toBe(0.8)

    const storage = {
      getItem: vi.fn((key: string) => (key === 'fluxplayer-volume-v1' ? 'not-a-volume' : null)),
      setItem: vi.fn(),
    } as unknown as Storage
    vi.stubGlobal('window', { localStorage: storage })
    await importFreshPlayer()

    expect(usePlayer.getState().volume).toBe(0.8)
    expect(usePlayer.getState().audio.volume).toBe(0.8)
  })

  it('restores zero from the current volume key as a valid muted state', async () => {
    const storage = {
      getItem: vi.fn((key: string) => (key === 'fluxplayer-volume-v1' ? '0' : null)),
      setItem: vi.fn(),
    } as unknown as Storage
    vi.stubGlobal('window', { localStorage: storage })
    await importFreshPlayer()

    expect(storage.getItem).toHaveBeenCalledWith('fluxplayer-volume-v1')
    expect(usePlayer.getState().volume).toBe(0)
    expect(usePlayer.getState().audio.volume).toBe(0)
  })

  it('persists and restores zero and fractional volume using the current key', async () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    } as unknown as Storage
    vi.stubGlobal('window', { localStorage: storage })
    await importFreshPlayer()

    usePlayer.getState().setVolume(0)
    expect(storage.setItem).toHaveBeenCalledWith('fluxplayer-volume-v1', '0')
    expect(usePlayer.getState().audio.volume).toBe(0)

    usePlayer.getState().setVolume(0.35)
    expect(storage.setItem).toHaveBeenCalledWith('fluxplayer-volume-v1', '0.35')
    await importFreshPlayer()
    expect(usePlayer.getState().volume).toBe(0.35)
    expect(usePlayer.getState().audio.volume).toBe(0.35)
  })
})

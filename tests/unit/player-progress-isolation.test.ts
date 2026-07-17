import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FluxMusicApi } from '@shared/music-contract'
import type { UnifiedSong } from '@shared/models'
import { makeSong } from '../helpers/song'

vi.mock('@renderer/api', () => ({
  musicClient: {
    resolvePlayback: vi.fn(),
    search: vi.fn(),
  },
}))

class FakeAudio extends EventTarget {
  src = ''
  volume = 1
  preload = ''
  currentTime = 0
  duration = 180
  paused = true

  play(): Promise<void> {
    this.paused = false
    return Promise.resolve()
  }

  pause(): void {
    this.paused = true
  }

  load(): void {}
}

const track: UnifiedSong = makeSong({
  provider: 'netease',
  id: 'progress-track',
  name: 'Progress track',
  artist: 'Artist',
  artists: [{ name: 'Artist' }],
  duration: 180_000,
})

let usePlayer: (typeof import('@renderer/stores/player'))['usePlayer']
let usePlaybackProgress: (typeof import('@renderer/stores/player'))['usePlaybackProgress']
let resolvePlayback: ReturnType<typeof vi.fn<FluxMusicApi['resolvePlayback']>>

beforeEach(async () => {
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.stubGlobal('Audio', FakeAudio)

  const { musicClient } = await import('@renderer/api')
  resolvePlayback = vi.mocked(musicClient.resolvePlayback)
  resolvePlayback.mockReset().mockResolvedValue({
    provider: 'netease',
    url: 'flux-media://audio/progress-handle',
    playable: true,
    trial: false,
    level: 'hires',
    quality: 'hires',
  })
  ;({ usePlayer, usePlaybackProgress } = await import('@renderer/stores/player'))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('playback progress subscription boundary', () => {
  it('keeps sub-second updates in the progress store and patches the low-frequency player store once per second', async () => {
    await usePlayer.getState().setQueue([track], 0)

    const audio = usePlayer.getState().audio as unknown as FakeAudio
    audio.currentTime = 0
    usePlayer.getState().syncProgress()

    let playerUpdates = 0
    let progressUpdates = 0
    const unsubscribePlayer = usePlayer.subscribe(() => {
      playerUpdates += 1
    })
    const unsubscribeProgress = usePlaybackProgress.subscribe(() => {
      progressUpdates += 1
    })

    for (const position of [0.1, 0.2, 0.9]) {
      audio.currentTime = position
      usePlayer.getState().syncProgress()
    }

    expect(progressUpdates).toBe(3)
    expect(playerUpdates).toBe(0)
    expect(usePlaybackProgress.getState()).toEqual({ position: 0.9, duration: 180 })
    expect(usePlayer.getState().position).toBe(0)

    audio.currentTime = 1.1
    usePlayer.getState().syncProgress()

    expect(progressUpdates).toBe(4)
    expect(playerUpdates).toBe(1)
    expect(usePlaybackProgress.getState().position).toBe(1.1)
    expect(usePlayer.getState().position).toBe(1.1)

    unsubscribeProgress()
    unsubscribePlayer()
  })
})

/**
 * PlaybackEngine failure behavior: one source attempt, stable context, and an actionable Toast.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FluxMusicApi, PlaybackResolveResult } from '@shared/music-contract'
import type { ProviderId, UnifiedSong } from '@shared/models'
import { makeSong } from '../helpers/song'

const mocks = vi.hoisted(() => ({
  resolvePlayback: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@renderer/api', () => ({
  musicClient: {
    resolvePlayback: mocks.resolvePlayback,
  },
  musicErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
}))

vi.mock('@renderer/stores/toast', () => ({
  showToast: mocks.showToast,
}))

class FakeAudio extends EventTarget {
  static playScript: (src: string, audio: FakeAudio) => Promise<void> = () => Promise.resolve()
  error: MediaError | null = null
  src = ''
  volume = 1
  preload = ''
  currentTime = 0
  duration = Number.NaN
  paused = true

  play(): Promise<void> {
    this.paused = false
    return FakeAudio.playScript(this.src, this).catch((error: unknown) => {
      this.paused = true
      throw error
    })
  }

  pause(): void {
    this.paused = true
  }

  load(): void {}
}

function song(id: number, provider: ProviderId, overrides: Partial<UnifiedSong> = {}): UnifiedSong {
  return makeSong({
    provider,
    id,
    name: `歌曲${id}`,
    artist: '测试歌手',
    artists: [{ name: '测试歌手' }],
    duration: 180_000,
    mid: provider === 'qq' ? `MID${id}` : undefined,
    mediaMid: provider === 'qq' ? `MEDIA${id}` : undefined,
    ...overrides,
  })
}

function playable(provider: ProviderId, handle: string, level = 'hires'): PlaybackResolveResult {
  return {
    provider,
    url: `flux-media://audio/${handle}`,
    playable: true,
    trial: false,
    level,
    quality: level,
  }
}

function unavailable(provider: ProviderId, message = '版权受限'): PlaybackResolveResult {
  return {
    provider,
    url: null,
    playable: false,
    trial: false,
    reason: 'copyright_unavailable',
    restriction: {
      provider,
      category: 'copyright_unavailable',
      action: 'none',
      message,
    },
  }
}

let usePlayer: (typeof import('@renderer/stores/player'))['usePlayer']
let resolvePlayback: ReturnType<typeof vi.fn<FluxMusicApi['resolvePlayback']>>

beforeEach(async () => {
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.stubGlobal('Audio', FakeAudio)
  FakeAudio.playScript = () => Promise.resolve()
  mocks.resolvePlayback.mockReset()
  mocks.showToast.mockReset()
  resolvePlayback = mocks.resolvePlayback
  ;({ usePlayer } = await import('@renderer/stores/player'))
})

describe('PlaybackEngine failure behavior', () => {
  it('plays a source returned by the typed bridge', async () => {
    const current = song(1, 'netease')
    resolvePlayback.mockResolvedValue(playable('netease', 'primary'))

    await usePlayer.getState().setQueue([current], 0)

    expect(resolvePlayback).toHaveBeenCalledOnce()
    expect(resolvePlayback).toHaveBeenCalledWith(expect.objectContaining({ song: current, quality: 'hires' }))
    expect(mocks.showToast).not.toHaveBeenCalled()
    expect(usePlayer.getState()).toMatchObject({
      current,
      status: 'playing',
      resolvedQuality: 'hires',
    })
  })

  it('routes automatic quality downgrade feedback through the shared Toast', async () => {
    const current = song(1, 'netease')
    resolvePlayback.mockResolvedValue(playable('netease', 'standard-source', 'standard'))

    await usePlayer.getState().setQueue([current], 0)

    expect(mocks.showToast).toHaveBeenCalledOnce()
    expect(mocks.showToast).toHaveBeenCalledWith('网易云音质自动降级：请求高清臻音，实际播放标准', {
      title: '音质已自动调整',
      tone: 'warning',
    })
  })

  it('keeps the queue context and reports a resolve failure', async () => {
    const current = song(1, 'qq')
    const nextSong = song(2, 'qq')
    const queue = [current, nextSong]
    resolvePlayback.mockResolvedValue(unavailable('qq', '当前歌曲因版权限制无法播放'))

    await usePlayer.getState().setQueue(queue, 0)

    expect(resolvePlayback).toHaveBeenCalledOnce()
    expect(resolvePlayback).toHaveBeenCalledWith(expect.objectContaining({ song: current, quality: 'hires' }))
    expect(usePlayer.getState().queue).toEqual(queue)
    expect(usePlayer.getState()).toMatchObject({
      index: 0,
      current,
      status: 'error',
      message: '当前歌曲因版权限制无法播放',
    })
    expect(mocks.showToast).toHaveBeenCalledOnce()
    expect(mocks.showToast).toHaveBeenCalledWith('当前歌曲因版权限制无法播放', {
      title: '播放失败',
      tone: 'error',
      duration: 8000,
    })
  })

  it('reports a media element rejection without advancing the queue', async () => {
    const current = song(1, 'qq')
    const nextSong = song(2, 'qq')
    resolvePlayback.mockResolvedValue(playable('qq', 'media-hires'))
    FakeAudio.playScript = () => Promise.reject(new Error('CDN 拒绝了音频请求'))

    await usePlayer.getState().setQueue([current, nextSong], 0)

    expect(resolvePlayback).toHaveBeenCalledOnce()
    expect(usePlayer.getState()).toMatchObject({
      index: 0,
      current,
      status: 'error',
      message: 'CDN 拒绝了音频请求',
    })
    expect(mocks.showToast).toHaveBeenCalledWith(
      'CDN 拒绝了音频请求',
      expect.objectContaining({ tone: 'error' }),
    )
  })

  it('leaves loading as an error when the media element emits an error while play is pending', async () => {
    const current = song(1, 'qq')
    resolvePlayback.mockResolvedValue(playable('qq', 'media'))
    FakeAudio.playScript = (_src, audio) => {
      queueMicrotask(() => audio.dispatchEvent(new Event('error')))
      return new Promise<void>(() => {})
    }

    await usePlayer.getState().setQueue([current], 0)

    expect(resolvePlayback).toHaveBeenCalledOnce()
    expect(usePlayer.getState()).toMatchObject({
      current,
      status: 'error',
      message: '音频地址加载失败',
    })
    expect(mocks.showToast).toHaveBeenCalledOnce()
  })

  it('shows only one Toast when a failed media element emits duplicate error events', async () => {
    const current = song(1, 'qq')
    resolvePlayback.mockResolvedValue(playable('qq', 'media'))
    FakeAudio.playScript = (_src, audio) => {
      queueMicrotask(() => {
        audio.dispatchEvent(new Event('error'))
        audio.dispatchEvent(new Event('error'))
      })
      return new Promise<void>(() => {})
    }

    await usePlayer.getState().setQueue([current], 0)

    expect(usePlayer.getState().status).toBe('error')
    expect(mocks.showToast).toHaveBeenCalledOnce()
  })

  it('still allows an explicit Next action after a failure', async () => {
    const failed = song(1, 'netease')
    const nextSong = song(2, 'netease')
    resolvePlayback.mockImplementation(async ({ song: requestedSong }) =>
      requestedSong.id === failed.id
        ? unavailable('netease', '第一首无法播放')
        : playable('netease', 'next-song'),
    )

    await usePlayer.getState().setQueue([failed, nextSong], 0)
    expect(usePlayer.getState()).toMatchObject({ current: failed, status: 'error' })

    await usePlayer.getState().next()

    expect(resolvePlayback).toHaveBeenCalledTimes(2)
    expect(usePlayer.getState()).toMatchObject({ current: nextSong, index: 1, status: 'playing' })
  })

  it('ignores a late playback result after the user replaces the queue', async () => {
    const firstSong = song(1, 'qq')
    const secondSong = song(2, 'qq')
    let releaseFirst: (result: PlaybackResolveResult) => void = () => {}
    const firstResult = new Promise<PlaybackResolveResult>((resolve) => {
      releaseFirst = resolve
    })
    resolvePlayback.mockImplementation(({ song: requestedSong }) =>
      requestedSong.id === firstSong.id
        ? firstResult
        : Promise.resolve(playable('qq', 'second-song', 'exhigh')),
    )

    const staleLoad = usePlayer.getState().setQueue([firstSong], 0)
    await vi.waitFor(() => expect(resolvePlayback).toHaveBeenCalledOnce())
    await usePlayer.getState().setQueue([secondSong], 0)
    releaseFirst(unavailable('qq'))
    await staleLoad

    expect(usePlayer.getState()).toMatchObject({ current: secondSong, status: 'playing' })
    expect(usePlayer.getState().audio.src).toBe('flux-media://audio/second-song')
    expect(mocks.showToast).not.toHaveBeenCalled()
  })
})

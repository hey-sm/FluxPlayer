/**
 * PlaybackEngine 的取链、降档、换源与竞态回归测试。
 * 所有上游交互都通过 typed musicClient mock；renderer 永远只接收 opaque media URL。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FluxMusicApi, PlaybackResolveResult } from '@shared/music-contract'
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
    return FakeAudio.playScript(this.src).catch((error: unknown) => {
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
      action: 'switch_source',
      message,
    },
  }
}

let usePlayer: (typeof import('@renderer/stores/player'))['usePlayer']
let resolvePlayback: ReturnType<typeof vi.fn<FluxMusicApi['resolvePlayback']>>
let search: ReturnType<typeof vi.fn<FluxMusicApi['search']>>

beforeEach(async () => {
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.stubGlobal('Audio', FakeAudio)
  FakeAudio.playScript = () => Promise.resolve()

  const { musicClient } = await import('@renderer/api')
  resolvePlayback = vi.mocked(musicClient.resolvePlayback)
  search = vi.mocked(musicClient.search)
  resolvePlayback.mockReset()
  search.mockReset()
  ;({ usePlayer } = await import('@renderer/stores/player'))
})

describe('PlaybackEngine fallback orchestration', () => {
  it('plays a primary source returned by the typed bridge', async () => {
    const primary = song(1, 'netease')
    resolvePlayback.mockResolvedValue(playable('netease', 'primary'))

    await usePlayer.getState().setQueue([primary], 0)

    expect(resolvePlayback).toHaveBeenCalledOnce()
    expect(resolvePlayback).toHaveBeenCalledWith({ song: primary, quality: 'hires' })
    expect(search).not.toHaveBeenCalled()
    expect(usePlayer.getState()).toMatchObject({
      current: primary,
      status: 'playing',
      resolvedQuality: 'hires',
    })
    expect(usePlayer.getState().audio.src).toBe('flux-media://audio/primary')
  })

  it('downgrades QQ from hires to exhigh after media playback rejects and keeps the session ceiling', async () => {
    const first = song(1, 'qq')
    const second = song(2, 'qq')
    resolvePlayback.mockImplementation(async ({ song: requestedSong, quality }) =>
      playable('qq', `${requestedSong.id}-${quality}`, quality),
    )
    FakeAudio.playScript = (src) =>
      src.endsWith('-hires') ? Promise.reject(new Error('CDN rejected hires')) : Promise.resolve()

    await usePlayer.getState().setQueue([first, second], 0)
    await usePlayer.getState().next()

    expect(resolvePlayback.mock.calls.map(([request]) => [request.song.id, request.quality])).toEqual([
      [1, 'hires'],
      [1, 'exhigh'],
      [2, 'exhigh'],
    ])
    expect(usePlayer.getState()).toMatchObject({
      current: second,
      status: 'playing',
      resolvedQuality: 'exhigh',
    })
    expect(search).not.toHaveBeenCalled()
  })

  it('automatically switches an unavailable Netease song to a matching QQ source', async () => {
    const original = song(1, 'netease')
    const alternate = song(101, 'qq', { name: original.name })
    resolvePlayback.mockImplementation(async ({ song: requestedSong }) =>
      requestedSong.provider === 'netease'
        ? unavailable('netease')
        : playable('qq', 'qq-alternate', 'exhigh'),
    )
    search.mockResolvedValue({ provider: 'qq', songs: [alternate] })

    await usePlayer.getState().setQueue([original], 0)

    expect(search).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledWith({
      provider: 'qq',
      keywords: `${original.name} ${original.artist}`,
      limit: 8,
    })
    expect(usePlayer.getState()).toMatchObject({
      current: alternate,
      status: 'playing',
      resolvedQuality: 'exhigh',
    })
    expect(usePlayer.getState().queue[0]).toBe(alternate)
  })

  it('automatically switches an unavailable QQ song to a matching Netease source', async () => {
    const original = song(1, 'qq')
    const alternate = song(101, 'netease', { name: original.name })
    resolvePlayback.mockImplementation(async ({ song: requestedSong }) =>
      requestedSong.provider === 'qq'
        ? unavailable('qq')
        : playable('netease', 'netease-alternate', 'exhigh'),
    )
    search.mockResolvedValue({ provider: 'netease', songs: [alternate] })

    await usePlayer.getState().setQueue([original], 0)

    expect(search).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledWith({
      provider: 'netease',
      keywords: `${original.name} ${original.artist}`,
      limit: 12,
    })
    expect(usePlayer.getState()).toMatchObject({
      current: alternate,
      status: 'playing',
      resolvedQuality: 'exhigh',
    })
  })

  it('skips to the next queue item when both the primary and alternate sources fail', async () => {
    const original = song(1, 'qq')
    const alternate = song(101, 'netease', { name: original.name })
    const nextSong = song(2, 'qq')
    resolvePlayback.mockImplementation(async ({ song: requestedSong }) =>
      requestedSong.id === nextSong.id
        ? playable('qq', 'next-song', 'exhigh')
        : unavailable(requestedSong.provider),
    )
    search.mockResolvedValue({ provider: 'netease', songs: [alternate] })

    await usePlayer.getState().setQueue([original, nextSong], 0)
    await vi.waitFor(() => {
      expect(usePlayer.getState()).toMatchObject({ current: nextSong, status: 'playing' })
    })

    expect(search).toHaveBeenCalledOnce()
    expect(resolvePlayback.mock.calls.some(([request]) => request.song.id === alternate.id)).toBe(true)
    expect(resolvePlayback.mock.calls.at(-1)?.[0].song.id).toBe(nextSong.id)
    expect(usePlayer.getState().notice).toContain('正在播放下一首')
  })

  it('ignores a late playback result after the user quickly replaces the queue', async () => {
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
    expect(search).not.toHaveBeenCalled()
  })
})

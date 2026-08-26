/**
 * Regression: chksz 取链在快速切歌时被代次抢占并 abort，避免旧歌的 chksz 节流等待/fetch
 * 拖慢新歌、消耗上游配额、以及旧结果覆盖新歌。
 *
 * 主进程 MusicService.resolvePlayback 接收 renderer 透传的 resolveGeneration，保留最新代次
 * 的 AbortController，更早代次的 chksz 在途请求会被 abort 并以 superseded 拒绝。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnifiedSong } from '@shared/models'
import { MusicService } from '@server/music'
import type { CredentialStore, UpstreamPlaybackResource } from '@server/types'
import { ChkszProvider } from '@server/providers/chksz'

const credentials: CredentialStore = {
  get: vi.fn((key: string) => (key === 'chksz' ? 'fixture-key' : '')),
  set: vi.fn(),
}

const neteaseSong: UnifiedSong = {
  provider: 'netease',
  type: 'song',
  id: 1,
  name: 'Song A',
  artist: 'Artist A',
  artists: [{ name: 'Artist A' }],
  album: '',
  cover: '',
  duration: 180_000,
}

function playback(): UpstreamPlaybackResource {
  return {
    provider: 'netease',
    url: `https://media.example/track`,
    headers: {},
    trial: false,
    playable: true,
    requestedQuality: 'exhigh',
  }
}

/** 直连无音源，触发 chksz 兜底。 */
function noSource(): UpstreamPlaybackResource {
  return {
    provider: 'netease',
    url: null,
    headers: {},
    trial: false,
    playable: false,
    requestedQuality: 'exhigh',
    reason: 'CHKSZ_NO_URL',
    message: 'no source',
  }
}

describe('MusicService resolvePlayback generation cancellation', () => {
  let service: MusicService

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(credentials.get).mockImplementation((key: string) => (key === 'chksz' ? 'fixture-key' : ''))
    service = new MusicService(credentials)
  })

  it('aborts an earlier-generation chksz in-flight request when a newer generation arrives', async () => {
    // 直连总是无音源 → 必走 chksz 兜底
    vi.spyOn(service.netease, 'resolvePlayback').mockResolvedValue(noSource())

    // 让 gen=1 的 chksz 取链悬挂，直到我们手动 resolve
    let resolveGen1!: (value: UpstreamPlaybackResource) => void
    const gen1Pending = new Promise<UpstreamPlaybackResource>((resolve) => {
      resolveGen1 = resolve
    })
    const chkszResolve = vi
      .spyOn(ChkszProvider.prototype, 'resolvePlayback')
      .mockImplementationOnce(async () => gen1Pending)

    // gen=1 开始解析（chksz 在途）
    const gen1Promise = service.resolvePlayback({
      song: neteaseSong,
      quality: 'exhigh',
      resolveGeneration: 1,
    })

    // gen=2 到来，应抢占 gen=1，abort 其 chksz 在途
    chkszResolve.mockResolvedValueOnce({
      provider: 'netease',
      url: 'https://media.example/gen2',
      headers: {},
      trial: false,
      playable: true,
      requestedQuality: 'exhigh',
    })
    const gen2Result = await service.resolvePlayback({
      song: neteaseSong,
      quality: 'exhigh',
      resolveGeneration: 2,
    })
    expect(gen2Result.upstreamUrl).toBe('https://media.example/gen2')

    // 释放 gen=1 的 chksz（模拟旧请求延迟返回）——它应被当作 superseded 拒绝
    resolveGen1({
      provider: 'netease',
      url: 'https://media.example/gen1-stale',
      headers: {},
      trial: false,
      playable: true,
      requestedQuality: 'exhigh',
    })
    await expect(gen1Promise).rejects.toThrow()
  })

  it('ignores requests with a generation older than the latest seen', async () => {
    vi.spyOn(service.netease, 'resolvePlayback').mockResolvedValue(playback())

    // gen=5 正常返回
    await service.resolvePlayback({ song: neteaseSong, quality: 'exhigh', resolveGeneration: 5 })

    // gen=3 应被直接拒绝（superseded），不调用 provider
    const providerSpy = vi.spyOn(service.netease, 'resolvePlayback')
    await expect(
      service.resolvePlayback({ song: neteaseSong, quality: 'exhigh', resolveGeneration: 3 }),
    ).rejects.toThrow()
    expect(providerSpy).not.toHaveBeenCalled()
  })

  it('does not enforce generation when resolveGeneration is omitted (legacy callers)', async () => {
    vi.spyOn(service.netease, 'resolvePlayback').mockResolvedValue(playback())
    // 不传 resolveGeneration → 正常解析，不受代次机制影响
    const result = await service.resolvePlayback({ song: neteaseSong, quality: 'exhigh' })
    expect(result.upstreamUrl).toBe('https://media.example/track')
  })
})

describe('chksz client request cancellation', () => {
  it('rejects with AbortError when the caller aborts during the throttle wait', async () => {
    const { chkszRequest } = await import('@server/providers/chksz/client')

    // 先发一次请求让 lastRequestAt 置为"刚刚"，使下一次进入节流等待
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 200, data: {} }), { status: 200 }),
    )
    await chkszRequest('/api/163_music', 'fixture-key', { id: '1', type: 'json' })

    // 下一次请求会进入 1.5s 节流等待；我们在等待中 abort
    const controller = new AbortController()
    const pending = chkszRequest(
      '/api/163_music',
      'fixture-key',
      { id: '2', type: 'json' },
      {
        signal: controller.signal,
      },
    )
    // 让 microtask 进入 respectRateLimit 的 setTimeout 等待
    await new Promise((resolve) => setImmediate(resolve))
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    vi.restoreAllMocks()
  })
})

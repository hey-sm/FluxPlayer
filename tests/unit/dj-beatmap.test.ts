import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { registerMiscRoutes } from '@server/routes/misc'
import { createPodcastDjAnalyzer, DJ_ANALYZER_LIMITS } from '@server/beatmap/analyzer'
import { analyzerUnavailable } from '@server/beatmap/errors'
import type { DjBeatMap, PodcastDjAnalyzer } from '@server/beatmap/types'
import type { ServerConfig } from '@server/types'

const tempDirs: string[] = []

class FakeDecoder {
  readonly ready = Promise.resolve()
  decode(_value: Uint8Array) {
    return { samplesDecoded: 0, channelData: [] }
  }
  free(): void {}
}

function makeCacheDir(): string {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-dj-beatmap-'))
  tempDirs.push(dir)
  return dir
}

function beatMap(): DjBeatMap {
  const beat = { time: 0.5, strength: 0.8, impact: 0.7 }
  return {
    kicks: [0.5],
    beats: [beat],
    pulseBeats: [beat],
    cameraBeats: [beat],
    gridStep: 0.5,
    duration: 120,
    visualBeatCount: 1,
    tempoSource: 'podcast-dj-server-test',
    analyzedAt: 123,
  }
}

function config(beatCacheDir = makeCacheDir()): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    staticRoot: '.',
    appVersion: 'test',
    beatCacheDir,
    credentials: { get: () => '', set: () => {} },
  }
}

function makeAnalyzer(overrides: Partial<PodcastDjAnalyzer> = {}): PodcastDjAnalyzer {
  return {
    analyzeStream: vi.fn(async () => beatMap()),
    analyzeIntro: vi.fn(async () => beatMap()),
    ...overrides,
  }
}

function makeApp(analyzer: PodcastDjAnalyzer, beatCacheDir?: string): Hono {
  const app = new Hono()
  registerMiscRoutes(app, config(beatCacheDir), { djAnalyzer: analyzer })
  return app
}

function endpoint(audioUrl: string, tail = '&duration=120'): string {
  return `/api/podcast/dj-beatmap?url=${encodeURIComponent(audioUrl)}${tail}`
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('/api/podcast/dj-beatmap', () => {
  it('用可注入 analyzer 返回 legacy 成功形状的字段超集，并保存 userData 缓存', async () => {
    const analyzer = makeAnalyzer()
    const app = makeApp(analyzer)
    const secretUrl = 'https://media.example.test/show/episode.mp3?token=TOP_SECRET&episode=42'

    const response = await app.request(endpoint(secretUrl, '&duration=120&intro=180'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      map: { visualBeatCount: 1, tempoSource: 'podcast-dj-server-test' },
      hit: false,
      cached: false,
      cacheSaved: true,
    })
    expect(typeof body.cacheKey).toBe('string')
    expect(body.cacheKey).not.toContain('TOP_SECRET')
    expect(analyzer.analyzeIntro).toHaveBeenCalledWith(
      secretUrl,
      expect.objectContaining({ durationSec: 120, introSec: 180 }),
    )

    const logged = JSON.stringify([
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ])
    expect(logged).toContain('https://media.example.test/show/episode.mp3')
    expect(logged).not.toContain('TOP_SECRET')
    expect(logged).not.toContain('token=')
  })

  it('相同媒体的 token 刷新后命中同一 BeatMapCache，不重复分析', async () => {
    const cacheDir = makeCacheDir()
    const analyzer = makeAnalyzer()
    const app = makeApp(analyzer, cacheDir)

    const first = await app.request(endpoint('https://media.example.test/episode-7.mp3?token=first&episode=7'))
    expect(first.status).toBe(200)
    expect((await first.json()).hit).toBe(false)

    const second = await app.request(endpoint('https://media.example.test/episode-7.mp3?token=second&episode=7'))
    const body = await second.json()
    expect(second.status).toBe(200)
    expect(body).toMatchObject({ ok: true, hit: true, cached: true, map: { visualBeatCount: 1 } })
    expect(analyzer.analyzeStream).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['/api/podcast/dj-beatmap', 'Invalid audio url'],
    [endpoint('file:///etc/passwd'), 'Invalid audio url'],
    [endpoint('https://media.example.test/a.mp3', '&duration=-1'), 'Invalid duration'],
    [endpoint('https://user:pass@media.example.test/a.mp3'), 'Invalid audio url'],
  ])('拒绝坏输入 %s', async (url, message) => {
    const analyzer = makeAnalyzer()
    const response = await makeApp(analyzer).request(url)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({ ok: false, error: message, code: 'DJ_INVALID_INPUT', fallback: true })
    expect(analyzer.analyzeStream).not.toHaveBeenCalled()
    expect(analyzer.analyzeIntro).not.toHaveBeenCalled()
  })

  it('把上游超时归一化为可重试、可降级的 504', async () => {
    const timeout = new DOMException('request timed out', 'TimeoutError')
    const analyzer = makeAnalyzer({ analyzeStream: vi.fn(async () => Promise.reject(timeout)) })

    const response = await makeApp(analyzer).request(endpoint('https://media.example.test/a.mp3?token=SECRET'))
    const body = await response.json()

    expect(response.status).toBe(504)
    expect(body).toEqual({
      ok: false,
      error: 'DJ_UPSTREAM_TIMEOUT',
      code: 'DJ_UPSTREAM_TIMEOUT',
      fallback: true,
      retryable: true,
    })
  })

  it('把上游状态失败归一化为 502，且日志不包含原始 token URL', async () => {
    const analyzer = makeAnalyzer({ analyzeStream: vi.fn(async () => Promise.reject(new Error('Audio fetch failed: 403'))) })
    const secretUrl = 'https://media.example.test/a.mp3?vkey=VERY_SECRET'

    const response = await makeApp(analyzer).request(endpoint(secretUrl))
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body).toMatchObject({ ok: false, error: 'DJ_UPSTREAM_FAILED', code: 'DJ_UPSTREAM_FAILED', fallback: true })
    expect(JSON.stringify((console.error as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('VERY_SECRET')
  })

  it('在解码前拒绝超过完整流大小上限的上游响应', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(new Uint8Array([1]), {
        headers: { 'content-length': String(DJ_ANALYZER_LIMITS.fullMaxBytes + 1) },
      })
    }) as unknown as typeof fetch
    const analyzer = createPodcastDjAnalyzer({
      fetchImpl,
      decoderLoader: async () => FakeDecoder,
    })

    const response = await makeApp(analyzer).request(endpoint('https://media.example.test/huge.mp3'))
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body).toMatchObject({
      ok: false,
      error: 'DJ_UPSTREAM_TOO_LARGE',
      code: 'DJ_UPSTREAM_TOO_LARGE',
      fallback: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('无服务端解码能力时返回标准降级错误，不崩溃', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const analyzer = createPodcastDjAnalyzer({
      fetchImpl,
      decoderLoader: async () => Promise.reject(analyzerUnavailable()),
    })

    const response = await makeApp(analyzer).request(endpoint('https://media.example.test/a.mp3'))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({
      ok: false,
      error: 'DJ_ANALYZER_UNAVAILABLE',
      code: 'DJ_ANALYZER_UNAVAILABLE',
      fallback: true,
      retryable: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('未知分析失败收敛为稳定错误，不把内部 message 返回给前端', async () => {
    const analyzer = makeAnalyzer({ analyzeStream: vi.fn(async () => Promise.reject(new Error('decoder exploded SECRET'))) })

    const response = await makeApp(analyzer).request(endpoint('https://media.example.test/a.mp3'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({ ok: false, error: 'DJ_ANALYSIS_FAILED', code: 'DJ_ANALYSIS_FAILED', fallback: true })
    expect(JSON.stringify(body)).not.toContain('decoder exploded')
  })
})

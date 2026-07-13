import { Hono } from 'hono'
import type { ServerConfig } from '../types'
import { BeatMapCache } from '../beatmap/cache'
import { createPodcastDjAnalyzer } from '../beatmap/analyzer'
import { normalizeDjBeatmapError } from '../beatmap/errors'
import {
  DjBeatmapService,
  parseDjBeatmapRequest,
  safeAudioTargetForLog,
} from '../beatmap/service'
import type { PodcastDjAnalyzer } from '../beatmap/types'

/**
 * 杂项与兼容路由：
 * - /api/app/version：新实现（更新通道字段固定为未配置——手写更新系统已按 M0 决策移除）
 * - 更新/补丁端点：返回明确的"系统已移除"，防止 legacy 前端触发旧更新链路
 * - 节拍图磁盘缓存：userData/beatmaps（形状与旧版兼容）
 * - 播客服务端 DJ 节拍：机械迁移旧 analyzer，带 userData 缓存与可降级错误
 */
export interface MiscRouteDependencies {
  djAnalyzer?: PodcastDjAnalyzer
}

export function registerMiscRoutes(app: Hono, config: ServerConfig, dependencies: MiscRouteDependencies = {}): void {
  app.get('/api/app/version', (c) =>
    c.json({
      name: 'fluxplayer',
      productName: 'FluxPlayer',
      version: config.appVersion,
      legacyMode: !!config.legacyMode,
      update: {
        provider: 'none',
        configured: false,
        owner: '',
        repo: '',
        preview: false,
        manifestOverride: false,
      },
    }),
  )

  // ---- 更新系统（已移除，M6 换 electron-updater） ----
  app.get('/api/update/latest', (c) =>
    c.json({
      configured: false,
      updateAvailable: false,
      currentVersion: config.appVersion,
      latestVersion: config.appVersion,
      notes: [],
      reason: 'UPDATE_CHANNEL_REMOVED',
    }),
  )
  const updateRemoved = (c: any) => c.json({ ok: false, error: 'UPDATE_SYSTEM_REMOVED' }, 400)
  app.all('/api/update/download', updateRemoved)
  app.all('/api/update/download/status', updateRemoved)
  app.all('/api/update/patch', updateRemoved)
  app.all('/api/update/patch/status', updateRemoved)

  // ---- 节拍图磁盘缓存（userData/beatmaps） ----
  const beatCache = new BeatMapCache(config.beatCacheDir)
  app.get('/api/beatmap/cache/status', (c) => {
    const info = beatCache.info()
    return c.json({ enabled: true, dir: info.dir, drive: info.drive, reason: '', mode: 'disk' })
  })
  app.get('/api/beatmap/cache', (c) => {
    const key = c.req.query('key') || ''
    try {
      const entry = beatCache.read(key)
      return c.json(
        entry
          ? { ok: true, hit: true, key: entry.key || key, map: entry.map, meta: entry.meta || {}, savedAt: entry.savedAt || 0 }
          : { ok: true, hit: false, key },
      )
    } catch (err: any) {
      const info = beatCache.info()
      return c.json({
        ok: false,
        hit: false,
        enabled: false,
        mode: 'memory-only',
        key,
        reason: err.code || err.message || 'BEAT_CACHE_READ_FAILED',
        dir: info.dir,
      })
    }
  })
  app.post('/api/beatmap/cache', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}))
      return c.json(beatCache.write(body))
    } catch (err: any) {
      const info = beatCache.info()
      return c.json({
        ok: false,
        enabled: false,
        mode: 'memory-only',
        reason: err.code || err.message || 'BEAT_CACHE_WRITE_FAILED',
        dir: info.dir,
      })
    }
  })

  // ---- 服务端 DJ 节拍分析（路径及旧 ok/map/error 字段保持兼容） ----
  const djBeatmaps = new DjBeatmapService(beatCache, dependencies.djAnalyzer || createPodcastDjAnalyzer())
  app.get('/api/podcast/dj-beatmap', async (c) => {
    const startedAt = Date.now()
    let target = '[invalid audio URL]'
    try {
      const request = parseDjBeatmapRequest({
        url: c.req.query('url'),
        duration: c.req.query('duration'),
        intro: c.req.query('intro'),
      })
      target = safeAudioTargetForLog(request.audioUrl)
      console.log('[PodcastDjBeatmap] start', {
        target,
        durationSec: Math.round(request.durationSec),
        introSec: Math.round(request.introSec),
      })
      const result = await djBeatmaps.analyze(request)
      console.log('[PodcastDjBeatmap] done', {
        target,
        hit: result.hit,
        beats: result.map.visualBeatCount || 0,
        elapsedMs: Date.now() - startedAt,
      })
      return c.json({
        ok: true,
        map: result.map,
        hit: result.hit,
        cached: result.hit,
        cacheKey: result.cacheKey,
        cacheSaved: result.cacheSaved,
        savedAt: result.savedAt,
      })
    } catch (error) {
      const normalized = normalizeDjBeatmapError(error)
      // Log only a path-level target and a normalized code; never log token-bearing query strings or raw errors.
      console.error('[PodcastDjBeatmap]', {
        target,
        code: normalized.code,
        elapsedMs: Date.now() - startedAt,
      })
      return c.json(
        {
          ok: false,
          error: normalized.publicMessage,
          code: normalized.code,
          fallback: normalized.fallback,
          retryable: normalized.retryable,
        },
        normalized.status as 400 | 413 | 500 | 502 | 503 | 504,
      )
    }
  })

  // ---- 播客域（未迁移；返回空集合的超集形状，legacy 各读取路径均得到空列表） ----
  const emptyPodcast = (c: any) =>
    c.json({ ok: true, radios: [], programs: [], items: [], playlists: [], voices: [], total: 0, hasMore: false })
  app.get('/api/podcast/search', emptyPodcast)
  app.get('/api/podcast/hot', emptyPodcast)
  app.get('/api/podcast/detail', emptyPodcast)
  app.get('/api/podcast/programs', emptyPodcast)
  app.get('/api/podcast/my', emptyPodcast)
  app.get('/api/podcast/my/items', emptyPodcast)
}

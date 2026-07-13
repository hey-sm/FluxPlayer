import crypto from 'node:crypto'
import type { BeatMapCache } from './cache'
import { DjBeatmapError, normalizeDjBeatmapError } from './errors'
import type { DjBeatMap, PodcastDjAnalyzer } from './types'

const MAX_URL_LENGTH = 8192
const MAX_DURATION_SEC = 24 * 60 * 60
const SENSITIVE_QUERY_KEY = /(?:token|auth|key|sign|sig|secret|ticket|cookie|session|vkey|guid|uin|expires?)/i

export interface DjBeatmapRequest {
  audioUrl: string
  durationSec: number
  introSec: number
}

export interface DjBeatmapResult {
  map: DjBeatMap
  hit: boolean
  cacheKey: string
  savedAt: number
  cacheSaved: boolean
}

function parseNonNegativeNumber(raw: string | undefined, field: 'duration' | 'intro'): number {
  if (raw == null || raw.trim() === '') return 0
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new DjBeatmapError('DJ_INVALID_INPUT', {
      status: 400,
      publicMessage: `Invalid ${field}`,
    })
  }
  if (field === 'duration' && value > MAX_DURATION_SEC) {
    throw new DjBeatmapError('DJ_INVALID_INPUT', {
      status: 400,
      publicMessage: 'Invalid duration',
    })
  }
  return value
}

export function parseDjBeatmapRequest(query: { url?: string; duration?: string; intro?: string }): DjBeatmapRequest {
  const audioUrl = String(query.url || '').trim()
  if (!audioUrl || audioUrl.length > MAX_URL_LENGTH) {
    throw new DjBeatmapError('DJ_INVALID_INPUT', {
      status: 400,
      publicMessage: 'Invalid audio url',
    })
  }

  let parsed: URL
  try {
    parsed = new URL(audioUrl)
  } catch {
    throw new DjBeatmapError('DJ_INVALID_INPUT', {
      status: 400,
      publicMessage: 'Invalid audio url',
    })
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password || !parsed.hostname) {
    throw new DjBeatmapError('DJ_INVALID_INPUT', {
      status: 400,
      publicMessage: 'Invalid audio url',
    })
  }

  return {
    audioUrl: parsed.toString(),
    durationSec: parseNonNegativeNumber(query.duration, 'duration'),
    introSec: parseNonNegativeNumber(query.intro, 'intro'),
  }
}

/** Never returns credentials, fragments, or query parameters (audio URLs often carry playback tokens). */
export function safeAudioTargetForLog(audioUrl: string): string {
  try {
    const parsed = new URL(audioUrl)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return '[invalid audio URL]'
  }
}

function stableAudioIdentity(audioUrl: string): string {
  const parsed = new URL(audioUrl)
  parsed.hash = ''
  parsed.username = ''
  parsed.password = ''
  const safeParams = [...parsed.searchParams.entries()]
    .filter(([key]) => !SENSITIVE_QUERY_KEY.test(key))
    .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue))
  parsed.search = ''
  for (const [key, value] of safeParams) parsed.searchParams.append(key, value)
  return parsed.toString()
}

export function djBeatmapCacheKey(request: DjBeatmapRequest): string {
  const identity = stableAudioIdentity(request.audioUrl)
  const hash = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 32)
  const mode = request.introSec > 0 ? `intro-${Math.max(90, Math.min(240, request.introSec))}` : 'full'
  const duration = Math.round(request.durationSec * 1000)
  return `podcast-dj-v1-${mode}-${duration}-${hash}`
}

export class DjBeatmapService {
  constructor(
    private readonly cache: BeatMapCache,
    private readonly analyzer: PodcastDjAnalyzer,
  ) {}

  async analyze(request: DjBeatmapRequest): Promise<DjBeatmapResult> {
    const cacheKey = djBeatmapCacheKey(request)
    try {
      const cached = this.cache.read(cacheKey)
      if (cached?.map) {
        return {
          map: cached.map as DjBeatMap,
          hit: true,
          cacheKey,
          savedAt: Number(cached.savedAt) || 0,
          cacheSaved: true,
        }
      }
    } catch {
      // A corrupt/unavailable disk cache must never prevent analysis or the renderer fallback path.
    }

    try {
      const options = {
        durationSec: request.durationSec,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
      const map = request.introSec
        ? await this.analyzer.analyzeIntro(request.audioUrl, { ...options, introSec: request.introSec })
        : await this.analyzer.analyzeStream(request.audioUrl, options)
      if (!map || typeof map !== 'object') {
        throw new DjBeatmapError('DJ_ANALYSIS_FAILED', { status: 500 })
      }

      let savedAt = 0
      let cacheSaved = false
      try {
        const write = this.cache.write({
          key: cacheKey,
          provider: 'podcast',
          mode: request.introSec ? 'dj-intro' : 'dj-full',
          map,
        })
        cacheSaved = write.ok
        savedAt = Number(write.savedAt) || 0
      } catch {
        // Analysis is still useful when userData is temporarily read-only or unavailable.
      }
      return { map, hit: false, cacheKey, savedAt, cacheSaved }
    } catch (error) {
      throw normalizeDjBeatmapError(error)
    }
  }
}

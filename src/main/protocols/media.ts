import { randomUUID } from 'node:crypto'
import { MEDIA_SCHEME } from './constants'

const DEFAULT_CAPACITY = 128
const DEFAULT_TTL_MS = 30 * 60 * 1000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'

export interface AudioSource {
  url: string
  headers?: Readonly<Record<string, string>>
}

interface AudioHandleEntry {
  source: AudioSource
  expiresAt: number
}

export interface AudioHandleStoreOptions {
  capacity?: number
  ttlMs?: number
  now?: () => number
  createId?: () => string
}

export class AudioHandleStore {
  private readonly entries = new Map<string, AudioHandleEntry>()
  private readonly capacity: number
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly createId: () => string

  constructor(options: AudioHandleStoreOptions = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_CAPACITY))
    this.ttlMs = Math.max(1, Math.floor(options.ttlMs ?? DEFAULT_TTL_MS))
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
  }

  create(source: AudioSource): string {
    const upstream = new URL(source.url)
    if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
      throw new Error('INVALID_AUDIO_SOURCE_PROTOCOL')
    }
    this.pruneExpired()
    const handle = this.createUniqueId()
    this.entries.set(handle, {
      source: { url: upstream.href, headers: source.headers ? { ...source.headers } : undefined },
      expiresAt: this.now() + this.ttlMs,
    })
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value
      if (typeof oldest !== 'string') break
      this.entries.delete(oldest)
    }
    return handle
  }

  get(handle: string): AudioSource | null {
    const entry = this.entries.get(handle)
    if (!entry) return null
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(handle)
      return null
    }
    // Map insertion order is the LRU order. A successful read promotes the entry.
    this.entries.delete(handle)
    this.entries.set(handle, entry)
    return entry.source
  }

  delete(handle: string): boolean {
    return this.entries.delete(handle)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    this.pruneExpired()
    return this.entries.size
  }

  private createUniqueId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const handle = this.createId()
      if (/^[A-Za-z0-9_-]{16,128}$/.test(handle) && !this.entries.has(handle)) return handle
    }
    throw new Error('AUDIO_HANDLE_GENERATION_FAILED')
  }

  private pruneExpired(): void {
    const current = this.now()
    for (const [handle, entry] of this.entries) {
      if (entry.expiresAt <= current) this.entries.delete(handle)
    }
  }
}

export const COVER_HOST_SUFFIXES = [
  '.music.126.net',
  '.126.net',
  '.163.com',
  '.netease.com',
  '.qq.com',
  '.qpic.cn',
  '.qlogo.cn',
  '.tencent-cloud.cn',
] as const

export const COVER_EXACT_HOSTS = new Set(['y.gtimg.cn'])

export function isAllowedCoverUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return (
      COVER_EXACT_HOSTS.has(host) ||
      COVER_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))
    )
  } catch {
    return false
  }
}

function refererFor(rawUrl: string): string {
  const hostname = new URL(rawUrl).hostname.toLowerCase()
  return hostname.includes('qq.com') || hostname.includes('qpic.cn') || hostname.includes('qlogo.cn')
    ? 'https://y.qq.com/'
    : 'https://music.163.com/'
}

function mediaRequestTarget(requestUrl: string): { kind: 'audio' | 'cover'; value: string } | null {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== `${MEDIA_SCHEME}:` || url.username || url.password || url.port) return null
    if (url.hostname === 'audio') {
      const handle = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(handle) || url.search || url.hash) return null
      return { kind: 'audio', value: handle }
    }
    if (url.hostname === 'cover' && (url.pathname === '' || url.pathname === '/')) {
      const source = url.searchParams.get('url') ?? ''
      return source ? { kind: 'cover', value: source } : null
    }
  } catch {
    // Invalid and malformed URLs are rejected below.
  }
  return null
}

export type MediaFetch = (input: string, init?: RequestInit) => Promise<Response>

function filteredResponseHeaders(upstream: Response, kind: 'audio' | 'cover'): Headers {
  const headers = new Headers()
  for (const name of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  const contentType = upstream.headers.get('content-type')
  headers.set('Content-Type', contentType ?? (kind === 'cover' ? 'image/jpeg' : 'audio/mpeg'))
  headers.set('X-Content-Type-Options', 'nosniff')
  if (kind === 'audio') {
    headers.set('Accept-Ranges', upstream.headers.get('accept-ranges') ?? 'bytes')
    headers.set('Cache-Control', 'no-store')
    headers.set('Access-Control-Allow-Origin', 'flux://app')
  } else {
    headers.set('Cache-Control', 'public, max-age=86400')
    headers.set('Access-Control-Allow-Origin', 'flux://app')
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
  }
  return headers
}

async function fetchAllowedCover(
  fetchUpstream: MediaFetch,
  rawUrl: string,
  method: string,
): Promise<Response> {
  let current = rawUrl
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (!isAllowedCoverUrl(current)) return new Response('Media host blocked', { status: 403 })
    const upstream = await fetchUpstream(current, {
      method,
      headers: { 'User-Agent': USER_AGENT, Referer: refererFor(current) },
      redirect: 'manual',
    })
    if (upstream.status < 300 || upstream.status >= 400) return upstream
    const location = upstream.headers.get('location')
    if (!location) return upstream
    current = new URL(location, current).href
  }
  return new Response('Too many redirects', { status: 502 })
}

function validRange(value: string): boolean {
  const normalized = value.trim()
  if (!/^bytes=(?:\d+-\d*|-\d+)(?:,(?:\d+-\d*|-\d+))*$/i.test(normalized)) return false

  return normalized
    .slice(normalized.indexOf('=') + 1)
    .split(',')
    .every((segment) => {
      if (segment.startsWith('-')) return BigInt(segment.slice(1)) > 0n
      const [first, last] = segment.split('-', 2)
      return !last || BigInt(first) <= BigInt(last)
    })
}

export async function handleMediaRequest(
  store: AudioHandleStore,
  request: Request,
  fetchUpstream: MediaFetch,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  const target = mediaRequestTarget(request.url)
  if (!target) return new Response('Not found', { status: 404 })

  if (target.kind === 'cover') {
    if (!isAllowedCoverUrl(target.value)) return new Response('Media host blocked', { status: 403 })
    try {
      const upstream = await fetchAllowedCover(fetchUpstream, target.value, request.method)
      return new Response(request.method === 'HEAD' ? null : upstream.body, {
        status: upstream.status,
        headers: filteredResponseHeaders(upstream, 'cover'),
      })
    } catch {
      return new Response('Cover upstream unavailable', { status: 502 })
    }
  }

  const source = store.get(target.value)
  if (!source) return new Response('Media handle expired', { status: 410 })
  const range = request.headers.get('range')
  if (range && !validRange(range)) {
    return new Response('Invalid range', { status: 416, headers: { 'Accept-Ranges': 'bytes' } })
  }
  const headers = new Headers(source.headers)
  headers.set('User-Agent', headers.get('User-Agent') ?? USER_AGENT)
  if (range) headers.set('Range', range)
  try {
    const upstream = await fetchUpstream(source.url, {
      method: request.method,
      headers,
      redirect: 'follow',
    })
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: filteredResponseHeaders(upstream, 'audio'),
    })
  } catch {
    return new Response('Audio upstream unavailable', { status: 502 })
  }
}

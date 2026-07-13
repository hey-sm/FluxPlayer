/** 本地 API 客户端：开发模式走 vite 代理，生产/异常时回退到 preload 注入的 apiBase */

const apiBase =
  typeof window !== 'undefined' && window.fluxDesktop ? window.fluxDesktop.apiBase || '' : ''

export interface ApiErrorPayload {
  error?: string
  message?: string
  code?: string | number
  [key: string]: unknown
}

/** 非 2xx 响应的统一错误；Query 和播放器可稳定读取 status/payload。 */
export class ApiError extends Error {
  readonly status: number
  readonly statusText: string
  readonly path: string
  readonly payload: ApiErrorPayload | string | null

  constructor(options: {
    status: number
    statusText: string
    path: string
    payload: ApiErrorPayload | string | null
  }) {
    const { status, statusText, path, payload } = options
    const detail =
      payload && typeof payload === 'object'
        ? String(payload.message || payload.error || '')
        : String(payload || '')
    super(detail || `API request failed (${status}${statusText ? ` ${statusText}` : ''})`)
    this.name = 'ApiError'
    this.status = status
    this.statusText = statusText
    this.path = path
    this.payload = payload
  }
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  // 生产模式页面本身由本地 server 提供，相对路径即可；dev 模式有 vite 代理，
  // 但代理目标端口是猜测值，preload 的 apiBase 永远是权威值。
  return apiBase ? apiBase + path : path
}

async function readResponseBody(resp: Response): Promise<unknown> {
  const raw = await resp.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export async function apiJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(apiUrl(path), init)
  const data = await readResponseBody(resp)
  if (!resp.ok) {
    throw new ApiError({
      status: resp.status,
      statusText: resp.statusText,
      path,
      payload:
        typeof data === 'string' || (data != null && typeof data === 'object')
          ? (data as ApiErrorPayload | string)
          : null,
    })
  }
  return data as T
}

export function audioProxyUrl(upstreamUrl: string): string {
  return apiUrl('/api/audio?url=' + encodeURIComponent(upstreamUrl))
}

export function normalizeCoverSource(value: unknown): string {
  const source = String(value ?? '').trim()
  if (!source || source.startsWith('?') || source.startsWith('#')) return ''
  const normalized = source.startsWith('//') ? `https:${source}` : source
  if (!/^https?:\/\//i.test(normalized)) return ''
  try {
    const url = new URL(normalized)
    if (!url.hostname) return ''
    // Avoid mixed-content failures and QQ's legacy HTTP redirects.
    url.protocol = 'https:'
    return url.href
  } catch {
    return ''
  }
}

export function coverProxyUrl(upstreamUrl: string): string {
  const normalized = normalizeCoverSource(upstreamUrl)
  return normalized ? apiUrl('/api/cover?url=' + encodeURIComponent(normalized)) : ''
}

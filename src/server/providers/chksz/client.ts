/**
 * ChKSz API HTTP 客户端。
 *
 * 基础地址 https://api.chksz.com，所有业务接口通过查询参数 apikey 鉴权。
 * 限流 / 配额耗尽时按 HTTP 状态码分类抛出 ChkszApiError，供上层转换为
 * 面向用户的提示（顶栏 toast）。
 */
import { parseJSONText } from '../../util/http'

export const CHKSZ_BASE_URL = 'https://api.chksz.com'

/** ChKSz 业务错误分类。上层据此决定是否提示用户 / 是否回退到直连。 */
export type ChkszErrorCode =
  | 'CHKSZ_QUOTA_EXHAUSTED' // 402：免费 + 付费额度用尽
  | 'CHKSZ_RATE_LIMITED' // 429：触发限流
  | 'CHKSZ_UNAUTHORIZED' // 401：Key 无效或失效
  | 'CHKSZ_FORBIDDEN' // 403：被封禁
  | 'CHKSZ_NOT_FOUND' // 404：路径或资源不存在
  | 'CHKSZ_BAD_REQUEST' // 400：参数缺失
  | 'CHKSZ_UPSTREAM_UNAVAILABLE' // 502/503/504：上游不可用
  | 'CHKSZ_HTTP_ERROR' // 其它非 2xx

export class ChkszApiError extends Error {
  readonly code: ChkszErrorCode
  readonly statusCode: number
  readonly retryAfterMs?: number
  /** 上游 msg 字段，用于 toast 文案 */
  readonly upstreamMessage?: string

  constructor(
    code: ChkszErrorCode,
    statusCode: number,
    message: string,
    options?: { retryAfterMs?: number; upstreamMessage?: string },
  ) {
    super(message)
    this.name = 'ChkszApiError'
    this.code = code
    this.statusCode = statusCode
    this.retryAfterMs = options?.retryAfterMs
    this.upstreamMessage = options?.upstreamMessage
  }
}

function classifyStatus(status: number): ChkszErrorCode {
  switch (status) {
    case 400:
      return 'CHKSZ_BAD_REQUEST'
    case 401:
      return 'CHKSZ_UNAUTHORIZED'
    case 402:
      return 'CHKSZ_QUOTA_EXHAUSTED'
    case 403:
      return 'CHKSZ_FORBIDDEN'
    case 404:
      return 'CHKSZ_NOT_FOUND'
    case 429:
      return 'CHKSZ_RATE_LIMITED'
    case 502:
    case 503:
    case 504:
      return 'CHKSZ_UPSTREAM_UNAVAILABLE'
    default:
      return 'CHKSZ_HTTP_ERROR'
  }
}

/** 从响应里取 msg/message 字段，用于 toast 文案。 */
function readUpstreamMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    const msg = record.msg ?? record.message ?? record.error
    if (typeof msg === 'string' && msg.trim()) return msg.trim()
  }
  return undefined
}

export interface ChkszRequestOptions {
  /** 响应超时（毫秒），默认 15s。歌单等大响应可调高。 */
  timeoutMs?: number
  /** 请求方式，默认 GET。163 系列支持 POST，QQ / kugou 仅 GET。 */
  method?: 'GET' | 'POST'
}

/** ChKSz 限流最小间隔：20 次/分钟，留余量取 1.5s 间隔防突发。 */
const CHKSZ_MIN_INTERVAL_MS = 1500
let lastRequestAt = 0

/** 简单的全局节流：遵守平均速率，429 时再叠加 Retry-After。不保证精确，只防突发。 */
async function respectRateLimit(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastRequestAt
  if (elapsed < CHKSZ_MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, CHKSZ_MIN_INTERVAL_MS - elapsed))
  }
  lastRequestAt = Date.now()
}

/**
 * 发起一次 ChKSz 业务请求。apikey 必填，通过查询参数透传（文档明确要求）。
 * 失败时抛 ChkszApiError；成功时返回解析后的 JSON。
 */
export async function chkszRequest(
  path: string,
  apikey: string,
  params: Record<string, string | number | undefined>,
  options: ChkszRequestOptions = {},
): Promise<unknown> {
  if (!apikey) throw new ChkszApiError('CHKSZ_UNAUTHORIZED', 401, 'ChKSz API Key 未配置')
  await respectRateLimit()

  const query = new URLSearchParams()
  query.set('apikey', apikey)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== '') query.set(key, String(value))
  }

  const method = options.method ?? 'GET'
  const timeoutMs = options.timeoutMs ?? 15_000
  let target: string
  let init: RequestInit

  if (method === 'GET') {
    target = `${CHKSZ_BASE_URL}${path}?${query.toString()}`
    init = { method: 'GET', signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' }
  } else {
    target = `${CHKSZ_BASE_URL}${path}`
    init = {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: query.toString(),
    }
  }

  const response = await fetch(target, init)
  const text = await response.text()
  if (response.status >= 400) {
    let parsed: unknown
    try {
      parsed = parseJSONText(text)
    } catch {
      parsed = null
    }
    const retryAfter = response.headers.get('retry-after')
    const retryAfterMs = retryAfter ? Math.max(1000, Number(retryAfter) * 1000) : undefined
    throw new ChkszApiError(
      classifyStatus(response.status),
      response.status,
      `ChKSz HTTP ${response.status}`,
      {
        retryAfterMs,
        upstreamMessage:
          readUpstreamMessage(parsed) ?? (typeof text === 'string' ? text.slice(0, 200) : undefined),
      },
    )
  }

  // chksz 业务层也用 code 字段报错（200 状态但 code != 200 的情况）
  try {
    const parsed = parseJSONText(text)
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const code = record.code
      if (typeof code === 'number' && code !== 200) {
        throw new ChkszApiError('CHKSZ_HTTP_ERROR', code, `ChKSz code ${code}`, {
          upstreamMessage: readUpstreamMessage(parsed),
        })
      }
    }
    return parsed
  } catch (error) {
    if (error instanceof ChkszApiError) throw error
    // 非 JSON（纯文本 URL / 302 跳转体）直接返回原文
    return text
  }
}

/** Upstream HTTP helpers used by the QQ Music adapter. */

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  timeoutMs?: number
}

export async function requestText(
  targetUrl: string,
  opts: RequestOptions = {},
  body?: string,
): Promise<string> {
  const response = await fetch(targetUrl, {
    method: opts.method || 'GET',
    headers: opts.headers || {},
    body: body ?? undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    redirect: 'follow',
  })
  const text = await response.text()
  if (response.status >= 400) {
    const error = new Error(`HTTP ${response.status}`) as Error & { statusCode?: number; body?: string }
    error.statusCode = response.status
    error.body = text
    throw error
  }
  return text
}

export function parseJSONText(text: string): unknown {
  const source = String(text || '').replace(/^\uFEFF/, '')
  try {
    return JSON.parse(source) as unknown
  } catch {
    const match = source.match(/^[\w$.]+\(([\s\S]*)\)\s*;?\s*$/)
    if (match) {
      try {
        return JSON.parse(match[1]) as unknown
      } catch {
        // Fall through to the normalized upstream error.
      }
    }
    throw new Error('INVALID_UPSTREAM_JSON')
  }
}

export async function requestJson(
  targetUrl: string,
  opts: RequestOptions = {},
  body?: string,
): Promise<unknown> {
  return parseJSONText(await requestText(targetUrl, opts, body))
}

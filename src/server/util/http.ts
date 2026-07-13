/** 上游 HTTP 请求工具（QQ 音乐直连接口等使用） */

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  timeoutMs?: number
}

export async function requestText(targetUrl: string, opts: RequestOptions = {}, body?: string): Promise<string> {
  const resp = await fetch(targetUrl, {
    method: opts.method || 'GET',
    headers: opts.headers || {},
    body: body ?? undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10000),
    redirect: 'follow',
  })
  const text = await resp.text()
  if (resp.status >= 400) {
    const err = new Error('HTTP ' + resp.status) as Error & { statusCode?: number; body?: string }
    err.statusCode = resp.status
    err.body = text
    throw err
  }
  return text
}

export function parseJSONText(text: string): any {
  try {
    return JSON.parse(String(text || '').replace(/^\uFEFF/, ''))
  } catch {
    // QQ 部分旧接口返回 jsonp 或带前缀的文本，尽力剥壳
    const match = String(text || '').match(/^[\w$.]+\(([\s\S]*)\)\s*;?\s*$/)
    if (match) {
      try {
        return JSON.parse(match[1])
      } catch {
        /* fallthrough */
      }
    }
    throw new Error('Invalid JSON from upstream')
  }
}

export async function requestJson(targetUrl: string, opts: RequestOptions = {}, body?: string): Promise<any> {
  return parseJSONText(await requestText(targetUrl, opts, body))
}

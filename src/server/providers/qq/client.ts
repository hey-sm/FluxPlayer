import { UA, parseJSONText, requestText } from '../../util/http'

export const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
export const QQ_SMARTBOX_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg'
export const QQ_SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp'

export const QQ_HEADERS: Record<string, string> = {
  Referer: 'https://y.qq.com/',
  'User-Agent': UA,
}

/**
 * 老 fcgi 家族（c.y.qq.com）每个请求都要带的那一组样板参数。
 * g_tk=5381 是 hash33 对空串的结果，等价于"不带 token"；这些端点对它宽容，
 * 真要算需要 p_skey，见 QQSession。
 */
export function qqCommonParams(uin: string | number = '0'): Record<string, string> {
  const loginUin = String(uin || '0')
  return {
    g_tk: '5381',
    loginUin,
    hostUin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '0',
  }
}

export class QQClient {
  constructor(private readonly getCookie: () => string) {}

  get cookie(): string {
    return this.getCookie()
  }

  async musicuRequest(payload: Record<string, unknown>, opts: { cookie?: boolean } = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      ...QQ_HEADERS,
      'Content-Type': 'application/json;charset=UTF-8',
    }
    if (opts.cookie && this.cookie) headers.Cookie = this.cookie
    const text = await requestText(QQ_MUSICU_URL, { method: 'POST', headers }, JSON.stringify(payload))
    return parseJSONText(text)
  }

  /**
   * musicu 信封 `{ comm, <key>: { module, method, param } }`。
   * comm 默认 `{ ct: 24, cv: 0 }`（游客态）；取链要用 ct=19 + authst，由调用方覆盖。
   */
  async callMusicu(
    key: string,
    module: string,
    method: string,
    param: Record<string, unknown>,
    opts: { comm?: Record<string, unknown>; cookie?: boolean } = {},
  ): Promise<unknown> {
    return this.musicuRequest(
      { comm: { ct: 24, cv: 0, ...opts.comm }, [key]: { module, method, param } },
      { cookie: opts.cookie },
    )
  }

  async getJSON(
    targetUrl: string,
    params: Record<string, unknown>,
    opts: { headers?: Record<string, string>; cookie?: boolean } = {},
  ): Promise<unknown> {
    const url = new URL(targetUrl)
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value))
    }
    const headers: Record<string, string> = { ...QQ_HEADERS, ...(opts.headers ?? {}) }
    if (opts.cookie !== false && this.cookie) headers.Cookie = this.cookie
    const text = await requestText(url.toString(), { headers })
    return parseJSONText(text)
  }
}

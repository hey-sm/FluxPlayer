import { UA, parseJSONText, requestText } from '../../util/http'

export const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
export const QQ_SMARTBOX_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg'

export const QQ_HEADERS: Record<string, string> = {
  Referer: 'https://y.qq.com/',
  'User-Agent': UA,
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

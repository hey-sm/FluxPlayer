import { UA, parseJSONText, requestText } from '../../util/http'

/**
 * QQ 音乐统一请求器：
 * - musicuRequest: u.y.qq.com/cgi-bin/musicu.fcg 的 JSON POST（新式模块化接口）
 * - getJSON: 旧式 c.y.qq.com fcg GET 接口
 * 收敛自旧 server.js 的 qqMusicRequest / qqGetJSON / requestText 三件套。
 */

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

  async musicuRequest(payload: Record<string, any>, opts: { cookie?: boolean } = {}): Promise<any> {
    const body = JSON.stringify(payload)
    const headers: Record<string, string> = {
      ...QQ_HEADERS,
      'Content-Type': 'application/json;charset=UTF-8',
    }
    const cookie = this.cookie
    if (opts.cookie && cookie) headers.Cookie = cookie
    const text = await requestText(QQ_MUSICU_URL, { method: 'POST', headers }, body)
    return parseJSONText(text)
  }

  async getJSON(
    targetUrl: string,
    params: Record<string, any>,
    opts: { headers?: Record<string, string>; cookie?: boolean } = {},
  ): Promise<any> {
    const u = new URL(targetUrl)
    Object.keys(params || {}).forEach((k) => {
      if (params[k] != null) u.searchParams.set(k, String(params[k]))
    })
    const headers: Record<string, string> = { ...QQ_HEADERS, ...(opts.headers || {}) }
    const cookie = this.cookie
    if (opts.cookie !== false && cookie) headers.Cookie = cookie
    const text = await requestText(u.toString(), { headers })
    return parseJSONText(text)
  }
}

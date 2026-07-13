import { Hono } from 'hono'
import { UA } from './util/http'

/**
 * 媒体代理：/api/cover（封面，供 canvas 取像素）与 /api/audio（音频，支持 Range）。
 * 相比旧版的完全开放代理，这里增加了上游主机白名单（音源 CDN 域）。
 */

const ALLOWED_HOST_SUFFIXES = [
  // 网易云
  '.music.126.net',
  '.126.net',
  '.163.com',
  '.netease.com',
  // QQ 音乐
  '.qq.com',
  '.qqmusic.qq.com',
  '.qpic.cn',
  '.qlogo.cn',
  '.tencent-cloud.cn',
  '.stream.qqmusic.qq.com',
]

function isAllowedUpstream(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))
  } catch {
    return false
  }
}

function refererFor(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    if (host.includes('qq.com') || host.includes('qpic.cn') || host.includes('qlogo.cn')) {
      return 'https://y.qq.com/'
    }
  } catch {
    /* ignore */
  }
  return 'https://music.163.com/'
}

/**
 * 音频专用 Referer：QQ 音频 CDN（*.tc.qq.com / *.stream.qqmusic.*）靠 URL 里的 vkey 自鉴权，
 * 带浏览器 Referer 反而会触发防盗链 → 上游 403，前端表现为 "no supported source"。
 * 这类流媒体主机一律不带 Referer；其余走通用逻辑。
 */
function audioRefererFor(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    if (host.includes('.tc.qq.com') || host.includes('stream.qqmusic')) return ''
  } catch {
    /* ignore */
  }
  return refererFor(rawUrl)
}

function upstreamTargetForLog(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return '[invalid upstream URL]'
  }
}

function audioContentTypeForUrl(rawUrl: string, upstreamType: string | null): string {
  let pathname = ''
  try {
    pathname = new URL(rawUrl).pathname.toLowerCase()
  } catch {
    /* ignore */
  }
  if (/\.flac$/.test(pathname)) return 'audio/flac'
  if (/\.mp3$/.test(pathname)) return 'audio/mpeg'
  if (/\.(m4a|mp4)$/.test(pathname)) return 'audio/mp4'
  if (/\.ogg$/.test(pathname)) return 'audio/ogg'
  if (/\.wav$/.test(pathname)) return 'audio/wav'
  return upstreamType || 'audio/mpeg'
}

export function registerProxyRoutes(app: Hono): void {
  app.get('/api/cover', async (c) => {
    const coverUrl = c.req.query('url') || ''
    if (!/^https?:\/\//i.test(coverUrl)) {
      return c.text('Invalid cover url', 400, { 'Access-Control-Allow-Origin': '*' })
    }
    if (!isAllowedUpstream(coverUrl)) {
      return c.text('Upstream host not allowed', 403, { 'Access-Control-Allow-Origin': '*' })
    }
    try {
      const resp = await fetch(coverUrl, {
        headers: { 'User-Agent': UA, Referer: refererFor(coverUrl) },
      })
      const headers: Record<string, string> = {
        'Content-Type': resp.headers.get('content-type') || 'image/jpeg',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'public, max-age=86400',
      }
      const cl = resp.headers.get('content-length')
      if (cl) headers['Content-Length'] = cl
      return new Response(resp.body, { status: resp.status, headers })
    } catch (err: any) {
      console.error('[Cover]', err)
      return c.text('', 500)
    }
  })

  app.get('/api/audio', async (c) => {
    const audioUrl = c.req.query('url') || ''
    if (!audioUrl) return c.text('Missing url', 400)
    if (!isAllowedUpstream(audioUrl)) return c.text('Upstream host not allowed', 403)
    try {
      const headers: Record<string, string> = { 'User-Agent': UA }
      const referer = audioRefererFor(audioUrl)
      if (referer) headers.Referer = referer
      const range = c.req.header('range') || ''
      if (range) headers.Range = range
      const up = await fetch(audioUrl, { headers })
      // 上游非 2xx（防盗链 403、鉴权失败等）：透传真实状态码，绝不把错误页伪装成音频
      // 塞给 <audio>，否则前端只会看到含糊的 "no supported source"。
      if (up.status < 200 || up.status >= 300) {
        console.error('[Audio] upstream', up.status, upstreamTargetForLog(audioUrl))
        // 4xx/5xx 原样透传（旧版 writeHead(up.status)，416/404 等语义对媒体栈有意义），其余归 502
        return new Response(`Upstream responded ${up.status}`, {
          status: up.status >= 400 && up.status < 600 ? up.status : 502,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
        })
      }
      const out: Record<string, string> = {
        'Content-Type': audioContentTypeForUrl(audioUrl, up.headers.get('content-type')),
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      }
      const cl = up.headers.get('content-length')
      if (cl) out['Content-Length'] = cl
      const cr = up.headers.get('content-range')
      if (cr) out['Content-Range'] = cr
      return new Response(up.body, { status: up.status, headers: out })
    } catch (err: any) {
      console.error('[Audio]', String((err && err.message) || err || 'UNKNOWN_ERROR'))
      return c.text('', 500)
    }
  })
}

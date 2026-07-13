import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { createApp } from '@server/index'
import { registerProxyRoutes } from '@server/proxy'
import type { ServerConfig } from '@server/types'

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 0,
  staticRoot: '.',
  appVersion: 'test',
  beatCacheDir: '.',
  credentials: { get: () => '', set: () => {} },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('server dev 边界', () => {
  it('OPTIONS 预检短路并返回登录 POST 所需 CORS 头', async () => {
    const { app } = createApp(config)
    const response = await app.request('/api/qq/login/cookie', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    expect(response.headers.get('access-control-allow-headers')).toContain('Content-Type')
  })

  it('QQ 流媒体代理不发送 Referer，透传 Range 与媒体响应头', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: {
          'content-type': 'application/octet-stream',
          'content-range': 'bytes 0-2/10',
          'content-length': '3',
        },
      }),
    )
    const app = new Hono()
    registerProxyRoutes(app)
    const upstream = 'https://dl.stream.qqmusic.qq.com/C400MEDIA.m4a?vkey=SECRET&guid=1'

    const response = await app.request('/api/audio?url=' + encodeURIComponent(upstream), {
      headers: { Range: 'bytes=0-2' },
    })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('audio/mp4')
    expect(response.headers.get('content-range')).toBe('bytes 0-2/10')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Range).toBe('bytes=0-2')
    expect(headers.Referer).toBeUndefined()
  })

  it('上游错误日志剥离 vkey/query，不泄露完整音频 URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('forbidden', { status: 403 }))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = new Hono()
    registerProxyRoutes(app)
    const upstream = 'https://dl.stream.qqmusic.qq.com/C400MEDIA.m4a?vkey=TOP_SECRET&guid=123'

    const response = await app.request('/api/audio?url=' + encodeURIComponent(upstream))

    expect(response.status).toBe(403)
    const logged = JSON.stringify(error.mock.calls)
    expect(logged).toContain('https://dl.stream.qqmusic.qq.com/C400MEDIA.m4a')
    expect(logged).not.toContain('TOP_SECRET')
    expect(logged).not.toContain('vkey=')
  })

  it('renderer CSP 放行受控背景协议与 QQ 头像域，远程媒体与接口仍走本地代理', () => {
    const html = readFileSync(new URL('../../src/renderer/index.html', import.meta.url), 'utf8')
    expect(html).toContain("img-src 'self' data: blob: flux-background: http://127.0.0.1:* https://*.qlogo.cn;")
    expect(html).toContain("media-src 'self' blob: flux-background: http://127.0.0.1:*;")
    expect(html).toContain("connect-src 'self' http://127.0.0.1:*")
  })
})

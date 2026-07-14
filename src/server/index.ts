import { Hono } from 'hono'
import { serve, type ServerType } from '@hono/node-server'
import { NeteaseProvider } from './providers/netease'
import { QQProvider } from './providers/qq'
import { registerNeteaseRoutes } from './routes/netease'
import { registerQQRoutes } from './routes/qq'
import { registerMiscRoutes } from './routes/misc'
import { registerProxyRoutes } from './proxy'
import { registerStatic } from './static'
import type { ServerConfig } from './types'

export interface LocalServer {
  server: ServerType
  port: number
  netease: NeteaseProvider
  qq: QQProvider
  close(): Promise<void>
}

export function createApp(config: ServerConfig): { app: Hono; netease: NeteaseProvider; qq: QQProvider } {
  const app = new Hono()
  const netease = new NeteaseProvider(config.credentials)
  const qq = new QQProvider(config.credentials)

  // /api/* 统一响应头（与旧 sendJSON 行为一致）
  // dev 模式下页面由 vite dev server 提供，对 server 的调用是跨源的：
  // POST + application/json 会先触发 OPTIONS 预检，必须回 Allow-Methods/Headers 并短路，
  // 否则登录等写请求会被浏览器以 "Failed to fetch" 拦下。
  app.use('/api/*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    c.header('Access-Control-Allow-Headers', 'Content-Type')
    c.header('Access-Control-Max-Age', '86400')
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    if (c.req.method === 'OPTIONS') return c.body(null, 204)
    await next()
  })

  registerMiscRoutes(app, config)
  registerNeteaseRoutes(app, netease)
  registerQQRoutes(app, qq)
  registerProxyRoutes(app)
  registerStatic(app, config.staticRoot)

  return { app, netease, qq }
}

export function startLocalServer(config: ServerConfig): Promise<LocalServer> {
  const { app, netease, qq } = createApp(config)
  return new Promise((resolve, reject) => {
    try {
      const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
        console.log('======================================================')
        console.log(` FluxPlayer local server → http://${config.host}:${info.port}`)
        console.log('======================================================')
        resolve({
          server,
          port: info.port,
          netease,
          qq,
          close: () =>
            new Promise<void>((resolveClose, rejectClose) => {
              server.close((error?: Error) => {
                if (error) rejectClose(error)
                else resolveClose()
              })
            }),
        })
      })
      server.on('error', reject)
    } catch (err) {
      reject(err)
    }
  })
}

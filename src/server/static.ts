import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

/** 静态文件服务：限定在 root 内，禁止路径穿越 */
export function registerStatic(app: Hono, root: string): void {
  app.get('*', async (c) => {
    const pathname = decodeURIComponent(new URL(c.req.url).pathname)
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const resolvedRoot = path.resolve(root)
    const target = path.resolve(resolvedRoot, rel)
    if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
      return c.text('Forbidden', 403)
    }
    try {
      const data = await fs.readFile(target)
      const ext = path.extname(target).toLowerCase()
      return c.body(new Uint8Array(data), 200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
      })
    } catch {
      return c.text('Not Found', 404)
    }
  })
}

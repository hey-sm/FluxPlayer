import fs from 'node:fs/promises'
import path from 'node:path'
import { APP_SCHEME, PRODUCTION_CSP } from './constants'

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  )
}

function decodePathname(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname)
    if (decoded.includes('\0') || decoded.includes('\\')) return null
    return decoded
  } catch {
    return null
  }
}

export function resolveAppAssetPath(staticRoot: string, requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (
    url.protocol !== `${APP_SCHEME}:` ||
    url.hostname !== 'app' ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null
  }
  const decoded = decodePathname(url.pathname)
  if (!decoded || decoded.endsWith('/')) return null
  const segments = decoded.split('/')
  if (segments.some((segment) => segment === '..' || segment === '.')) return null
  const relative = decoded.replace(/^\/+/, '')
  if (!relative || path.isAbsolute(relative)) return null
  const root = path.resolve(staticRoot)
  const candidate = path.resolve(root, relative)
  return isInside(root, candidate) ? candidate : null
}

function responseHeaders(filePath: string, size: number): Headers {
  return new Headers({
    'Cache-Control':
      path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'Content-Length': String(size),
    'Content-Security-Policy': PRODUCTION_CSP,
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  })
}

export async function handleAppAssetRequest(staticRoot: string, request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  const filePath = resolveAppAssetPath(staticRoot, request.url)
  if (!filePath) return new Response('Not found', { status: 404 })
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return new Response('Not found', { status: 404 })
    const headers = responseHeaders(filePath, stat.size)
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
    return new Response(await fs.readFile(filePath), { status: 200, headers })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

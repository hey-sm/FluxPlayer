import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 节拍图磁盘缓存 —— 移植自旧 server.js。
 * 差异：缓存目录由宿主注入（Electron userData/beatmaps），
 * 不再有旧版"禁止 C 盘 / 固定 D:\MineradioCache"的机器特定策略。
 */
export class BeatMapCache {
  constructor(private readonly dir: string) {}

  info() {
    const dir = path.resolve(this.dir)
    const root = path.parse(dir).root
    const drive = root ? root.replace(/[\\/]+$/, '').toUpperCase() : ''
    return { dir, root, drive, allowed: true, available: true }
  }

  private ensureDir(): string {
    const dir = this.info().dir
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  private fileFor(key: unknown): string | null {
    const raw = String(key || '').trim()
    if (!raw || raw.length > 240) return null
    const hash = crypto.createHash('sha1').update(raw).digest('hex')
    const label =
      raw
        .replace(/[^a-z0-9_.-]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'beatmap'
    return path.join(this.ensureDir(), `${label}-${hash}.json`)
  }

  private compactPayload(body: any) {
    const key = String((body && body.key) || '').trim()
    const map = body && body.map
    if (!key || !map || typeof map !== 'object') return null
    return {
      v: 1,
      key,
      savedAt: Date.now(),
      meta: {
        provider: String(body.provider || '').slice(0, 32),
        title: String(body.title || '').slice(0, 160),
        artist: String(body.artist || '').slice(0, 160),
        mode: String(body.mode || 'mr').slice(0, 32),
      },
      map,
    }
  }

  read(key: unknown): any | null {
    const file = this.fileFor(key)
    if (!file || !fs.existsSync(file)) return null
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return raw && raw.map ? raw : null
  }

  write(body: any): { ok: boolean; key?: string; savedAt?: number; dir?: string; error?: string } {
    const payload = this.compactPayload(body)
    if (!payload) return { ok: false, error: 'INVALID_BEATMAP_CACHE_PAYLOAD' }
    const file = this.fileFor(payload.key)
    if (!file) return { ok: false, error: 'INVALID_BEATMAP_CACHE_KEY' }
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(payload))
    fs.renameSync(tmp, file)
    return { ok: true, key: payload.key, savedAt: payload.savedAt, dir: path.dirname(file) }
  }
}

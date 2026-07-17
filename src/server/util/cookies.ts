/** Cookie 解析/规范化 —— 移植自旧 server.js（行为保持一致） */

const COOKIE_ATTRIBUTE_NAMES = new Set([
  'path',
  'domain',
  'expires',
  'max-age',
  'samesite',
  'secure',
  'httponly',
])

function collectCookiePair(picked: Map<string, string>, key: unknown, value: unknown): void {
  const k = String(key || '').trim()
  if (!k || COOKIE_ATTRIBUTE_NAMES.has(k.toLowerCase())) return
  if (value === null || value === undefined) return
  picked.set(k, String(value).trim())
}

function collectCookieInput(input: unknown, picked: Map<string, string>): void {
  if (input === null || input === undefined) return
  if (Array.isArray(input)) {
    input.forEach((item) => collectCookieInput(item, picked))
    return
  }
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (obj.name && Object.prototype.hasOwnProperty.call(obj, 'value')) {
      collectCookiePair(picked, obj.name, obj.value)
      return
    }
    Object.keys(obj).forEach((key) => {
      const value = obj[key]
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
        collectCookiePair(picked, key, (value as Record<string, unknown>).value)
      } else if (typeof value !== 'object') {
        collectCookiePair(picked, key, value)
      }
    })
    return
  }
  String(input)
    .split(/\r?\n/)
    .forEach((line) => {
      line.split(';').forEach((part) => {
        const raw = String(part || '').trim()
        const idx = raw.indexOf('=')
        if (idx <= 0) return
        collectCookiePair(picked, raw.slice(0, idx), raw.slice(idx + 1))
      })
    })
}

export function normalizeCookieHeader(input: unknown): string {
  const picked = new Map<string, string>()
  collectCookieInput(input, picked)
  return Array.from(picked.entries())
    .filter(([key, value]) => key && value != null && String(value) !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join('; ')
}

export function rawCookieFallback(input: unknown): string {
  if (typeof input === 'string') return input.trim()
  if (Array.isArray(input) && input.every((item) => typeof item === 'string')) return input.join('; ').trim()
  return ''
}

export function parseCookieString(cookieText: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  String(cookieText || '')
    .split(';')
    .forEach((part) => {
      const raw = String(part || '').trim()
      if (!raw) return
      const idx = raw.indexOf('=')
      if (idx <= 0) return
      const key = raw.slice(0, idx).trim()
      const value = raw.slice(idx + 1).trim()
      if (key) out[key] = value
    })
  return out
}

export function serializeCookieObject(obj: Record<string, unknown>): string {
  return Object.keys(obj || {})
    .filter((k) => obj[k] != null && String(obj[k]) !== '')
    .map((k) => `${k}=${String(obj[k])}`)
    .join('; ')
}

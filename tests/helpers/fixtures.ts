import { readFileSync } from 'node:fs'

/** fixture 快照测试的公共工具：envelope 解包 + 挥发字段归一 */

export interface FixtureMeta {
  recordedAt: string
  provenance: 'recorded' | 'hand-seeded'
  endpoint: string
  method: 'GET' | 'POST'
  params: Record<string, unknown>
  trimmed?: Record<string, number>
  anonymous: true
}

/** 读取 tests/fixtures/<name>.fixture.json 并校验 envelope */
export function loadFixture<T = any>(name: string): { meta: FixtureMeta; response: T } {
  const url = new URL(`../fixtures/${name}.fixture.json`, import.meta.url)
  const doc = JSON.parse(readFileSync(url, 'utf8'))
  if (!doc || !doc.$fixture || !('response' in doc)) {
    throw new Error(`fixture ${name} 缺少 $fixture envelope（应由 scripts/record-fixtures.mjs 生成）`)
  }
  return { meta: doc.$fixture, response: doc.response }
}

/** 网易云封面 CDN 主机 p1/p2.music.126.net 会轮换 → 归一到 p1，消除重录时的假 diff */
export function normalizeNcmCover(url: unknown): string {
  return String(url || '').replace(/^https?:\/\/p\d+\.music\.126\.net\//, 'https://p1.music.126.net/')
}

/**
 * 自动换源的同名同歌手匹配 —— 移植旧 public/index.html 的
 * normalizeMatchText / artistNameParts / isSameTitleArtist / searchAlternatePlatformSong（纯逻辑部分）。
 */
import type { ProviderId, UnifiedSong } from '@shared/models'

/** 去括号注音（（Live）/(feat. X)/【注音】）与全半角标点/空白，lowercase */
export function normalizeMatchText(text: unknown): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[（(【[].*?[）)】\]]/g, '')
    .replace(/[\s·・\-—_.,，。:：'"“”‘’/\\|]+/g, '')
}

/** artists[].name + artist 字段按 / , 、 & feat. 切分，全部归一化 */
export function artistNameParts(song: Pick<UnifiedSong, 'artist' | 'artists'> | null | undefined): string[] {
  const parts: string[] = []
  if (song && Array.isArray(song.artists)) {
    for (const a of song.artists) if (a && a.name) parts.push(a.name)
  }
  if (song && song.artist) {
    for (const name of String(song.artist).split(/\s*\/\s*|\s*,\s*|、|&| feat\.? | ft\.? /i)) {
      if (name && name.trim()) parts.push(name.trim())
    }
  }
  return parts.map(normalizeMatchText).filter(Boolean)
}

/** 标题归一化后全等 + 任一歌手名交集 */
export function isSameTitleArtist(source: UnifiedSong, candidate: UnifiedSong): boolean {
  if (!source || !candidate) return false
  if (normalizeMatchText(source.name) !== normalizeMatchText(candidate.name)) return false
  const a = artistNameParts(source)
  const b = artistNameParts(candidate)
  if (!a.length || !b.length) return false
  return a.some((name) => b.includes(name))
}

export function alternateProvider(provider: ProviderId): ProviderId {
  return provider === 'qq' ? 'netease' : 'qq'
}

/** 搜索 API 路径的唯一模板（App 主搜索与换源搜索共用，改端点只动这里） */
export function searchPath(provider: ProviderId, keywords: string, limit: number): string {
  return provider === 'qq'
    ? `/api/qq/search?keywords=${encodeURIComponent(keywords)}&limit=${limit}`
    : `/api/search?keywords=${encodeURIComponent(keywords)}&limit=${limit}`
}

/** 换源搜索的 API 路径（qq→网易云 limit=12；netease→QQ limit=8，与旧版一致）；拼不出关键词返回 null */
export function alternateSearchPath(song: UnifiedSong): string | null {
  const target = alternateProvider(song.provider)
  const artist = song.artist || artistNameParts(song)[0] || ''
  const query = [song.name || '', artist].filter(Boolean).join(' ').trim()
  if (!query) return null
  return searchPath(target, query, target === 'qq' ? 8 : 12)
}

/** 候选列表里第一个同名同歌手项 */
export function pickAlternateSong(source: UnifiedSong, candidates: readonly UnifiedSong[]): UnifiedSong | null {
  for (const candidate of candidates) {
    if (isSameTitleArtist(source, candidate)) return candidate
  }
  return null
}

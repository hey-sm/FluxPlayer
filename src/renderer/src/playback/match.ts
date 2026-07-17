import type { ProviderId, UnifiedSong } from '@shared/models'

/** 去括号注音（（Live）/(feat. X)/【注音】）与全半角标点/空白，lowercase。 */
export function normalizeMatchText(text: unknown): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[（(【[].*?[）)】\]]/g, '')
    .replace(/[\s·・\-—_.,，。:：'"“”‘’/\\|]+/g, '')
}

export function artistNameParts(song: Pick<UnifiedSong, 'artist' | 'artists'> | null | undefined): string[] {
  const parts: string[] = []
  if (song && Array.isArray(song.artists)) {
    for (const artist of song.artists) if (artist?.name) parts.push(artist.name)
  }
  if (song?.artist) {
    for (const name of String(song.artist).split(/\s*\/\s*|\s*,\s*|、|&| feat\.? | ft\.? /i)) {
      if (name.trim()) parts.push(name.trim())
    }
  }
  return parts.map(normalizeMatchText).filter(Boolean)
}

export function isSameTitleArtist(source: UnifiedSong, candidate: UnifiedSong): boolean {
  if (normalizeMatchText(source.name) !== normalizeMatchText(candidate.name)) return false
  const sourceArtists = artistNameParts(source)
  const candidateArtists = artistNameParts(candidate)
  return (
    sourceArtists.length > 0 &&
    candidateArtists.length > 0 &&
    sourceArtists.some((name) => candidateArtists.includes(name))
  )
}

export function alternateProvider(provider: ProviderId): ProviderId {
  return provider === 'qq' ? 'netease' : 'qq'
}

export interface AlternateSearchRequest {
  provider: ProviderId
  keywords: string
  limit: number
}

/** 构造 typed IPC 搜索请求，不泄漏或拼接旧 HTTP API 路径。 */
export function alternateSearchRequest(song: UnifiedSong): AlternateSearchRequest | null {
  const provider = alternateProvider(song.provider)
  const artist = song.artist || artistNameParts(song)[0] || ''
  const keywords = [song.name || '', artist].filter(Boolean).join(' ').trim()
  if (!keywords) return null
  return { provider, keywords, limit: provider === 'qq' ? 8 : 12 }
}

export function pickAlternateSong(
  source: UnifiedSong,
  candidates: readonly UnifiedSong[],
): UnifiedSong | null {
  for (const candidate of candidates) {
    if (isSameTitleArtist(source, candidate)) return candidate
  }
  return null
}

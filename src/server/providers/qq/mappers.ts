import type { UnifiedArtist, UnifiedPlaylist, UnifiedSong } from '@shared/models'
import {
  asArray,
  asRecord,
  booleanValue,
  errorMessage,
  identifier,
  numberValue,
  stringValue,
} from '../../util/unknown'

export function qqAlbumCover(albumMid: string, size = 300): string {
  if (!albumMid) return ''
  return `https://y.qq.com/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg?max_age=2592000`
}

export function qqSingerAvatar(singerMid: string, size = 300): string {
  if (!singerMid) return ''
  return `https://y.qq.com/music/photo_new/T001R${size}x${size}M000${singerMid}.jpg?max_age=2592000`
}

export function mapQQArtists(raw: unknown): UnifiedArtist[] {
  return asArray(raw)
    .map((value): UnifiedArtist => {
      const artist = asRecord(value)
      return {
        id: identifier(artist.id),
        mid: stringValue(artist.mid) || undefined,
        name: stringValue(artist.name ?? artist.title),
      }
    })
    .filter((artist) => Boolean(artist.name))
}

export function mapQQSmartSong(raw: unknown): UnifiedSong {
  const item = asRecord(raw)
  const mid = stringValue(item.mid ?? item.songmid ?? item.id)
  const artist = stringValue(item.singer)
  return {
    provider: 'qq',
    type: 'qq',
    id: mid,
    qqId: identifier(item.id ?? item.docid) ?? '',
    mid,
    songmid: mid,
    name: stringValue(item.name ?? item.title),
    artist,
    artists: artist ? [{ name: artist }] : [],
    album: '',
    cover: '',
    duration: 0,
    fee: 0,
    playable: false,
  }
}

export function mapQQTrack(raw: unknown, fallback: Partial<UnifiedSong> = {}): UnifiedSong {
  const track = asRecord(raw)
  const album = asRecord(track.album)
  const file = asRecord(track.file)
  const artists = mapQQArtists(track.singer)
  const mid = stringValue(track.mid ?? fallback.mid ?? fallback.songmid)
  const albumMid = stringValue(album.mid ?? album.pmid)
  const pay = asRecord(track.pay)
  return {
    provider: 'qq',
    type: 'qq',
    id: mid,
    qqId: identifier(track.id ?? fallback.qqId ?? fallback.id) ?? '',
    mid,
    songmid: mid,
    mediaMid: stringValue(file.media_mid ?? track.strMediaMid ?? track.media_mid),
    name: stringValue(track.name ?? track.title ?? fallback.name),
    artist: artists.map((artist) => artist.name).join(' / ') || fallback.artist || '',
    artists: artists.length ? artists : (fallback.artists ?? []),
    artistId: artists[0]?.id ?? artists[0]?.mid,
    artistMid: artists[0]?.mid,
    album: stringValue(album.name ?? album.title ?? fallback.album),
    albumMid,
    cover: qqAlbumCover(albumMid) || fallback.cover || '',
    duration: numberValue(track.interval) * 1000,
    fee: numberValue(pay.pay_play) ? 1 : 0,
    playable: false,
  }
}

export function mapQQPlaylistTrack(raw: unknown): UnifiedSong {
  const root = asRecord(raw)
  const direct = root.songid ?? root.songmid ?? root.mid ?? root.name
  const track = direct ? root : asRecord(root.track_info ?? root.songInfo ?? root.songinfo ?? root.song)
  const album = asRecord(track.album)
  const file = asRecord(track.file)
  const artists = mapQQArtists(track.singer ?? track.singers)
  const mid = stringValue(track.mid ?? track.songmid ?? root.mid ?? root.songmid)
  const albumMid = stringValue(album.mid ?? track.albummid ?? root.albummid)
  const pay = asRecord(track.pay)
  const fallbackId = identifier(track.id ?? track.songid ?? root.id ?? root.songid) ?? ''
  return {
    provider: 'qq',
    type: 'qq',
    id: mid || String(fallbackId),
    qqId: fallbackId,
    mid,
    songmid: mid,
    mediaMid: stringValue(file.media_mid ?? track.strMediaMid ?? track.media_mid ?? root.strMediaMid),
    name: stringValue(track.name ?? track.songname ?? root.songname),
    artist:
      artists.map((artist) => artist.name).join(' / ') || stringValue(track.singername ?? root.singername),
    artists,
    artistId: artists[0]?.id ?? artists[0]?.mid,
    artistMid: artists[0]?.mid,
    album: stringValue(album.name ?? album.title ?? track.albumname ?? root.albumname),
    albumMid,
    cover: qqAlbumCover(albumMid),
    duration: numberValue(track.interval ?? root.interval) * 1000,
    fee: numberValue(pay.pay_play) ? 1 : 0,
    playable: false,
  }
}

export function mapQQPlaylist(raw: unknown, kind?: string): UnifiedPlaylist {
  const playlist = asRecord(raw)
  const id = identifier(playlist.dissid ?? playlist.tid ?? playlist.dirid ?? playlist.id ?? playlist.diss_id)
  return {
    provider: 'qq',
    type: 'playlist',
    id: id === undefined ? '' : String(id),
    name: stringValue(playlist.diss_name ?? playlist.name ?? playlist.title),
    cover: stringValue(playlist.diss_cover ?? playlist.logo ?? playlist.picurl ?? playlist.cover),
    trackCount: numberValue(
      playlist.song_cnt ?? playlist.songnum ?? playlist.total_song_num ?? playlist.song_count,
    ),
    playCount: numberValue(playlist.listen_num ?? playlist.visitnum ?? playlist.play_count),
    creator: stringValue(playlist.hostname ?? playlist.nick ?? playlist.creator, 'QQ 音乐'),
    subscribed: kind === 'collect' || booleanValue(playlist.subscribed),
    specialType: 0,
  }
}

export function isQQFavoritePlaylist(raw: unknown): boolean {
  return /我喜欢|我的喜欢|喜欢的音乐/i.test(stringValue(asRecord(raw).name).trim())
}

export function isQzoneBackgroundPlaylist(raw: unknown): boolean {
  const playlist = asRecord(raw)
  const text = `${stringValue(playlist.name)} ${stringValue(playlist.creator)}`.toLowerCase()
  return /qzone|空间|背景音乐/i.test(text)
}

export function decodeHtmlEntities(text: unknown): string {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCharCode(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
}

export function decodeQQLyricText(text: unknown): string {
  let raw = decodeHtmlEntities(String(text || '').trim())
  if (!raw) return ''
  const compact = raw.replace(/\s+/g, '')
  const looksBase64 =
    compact.length >= 8 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  if (looksBase64 && !/^\s*\[/.test(raw)) {
    try {
      const decoded = Buffer.from(compact, 'base64')
        .toString('utf8')
        .replace(/^\uFEFF/, '')
      if (decoded && (decoded.includes('[') || /[一-龥]/.test(decoded))) raw = decoded
    } catch (error) {
      console.warn('[QQLyrics] base64 decode failed:', errorMessage(error))
    }
  }
  return decodeHtmlEntities(raw).replace(/\r\n/g, '\n').trim()
}

export function normalizeQQSongId(id: unknown): number {
  const digits = String(id || '').replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

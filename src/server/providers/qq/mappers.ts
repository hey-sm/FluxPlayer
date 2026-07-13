import type { UnifiedPlaylist, UnifiedSong } from '@shared/models'

/** QQ 响应 → 统一模型的映射层（纯函数，可单测） */

export function qqAlbumCover(albumMid: string, size?: number): string {
  if (!albumMid) return ''
  const px = size || 300
  return `https://y.qq.com/music/photo_new/T002R${px}x${px}M000${albumMid}.jpg?max_age=2592000`
}

export function qqSingerAvatar(singerMid: string, size?: number): string {
  if (!singerMid) return ''
  const px = size || 300
  return `https://y.qq.com/music/photo_new/T001R${px}x${px}M000${singerMid}.jpg?max_age=2592000`
}

export function mapQQArtists(raw: any): Array<{ id?: number; mid?: string; name: string }> {
  return ((raw || []) as any[])
    .map((a) => ({ id: a && a.id, mid: a && a.mid, name: (a && (a.name || a.title)) || '' }))
    .filter((a) => a.name)
}

export function mapQQSmartSong(item: any): UnifiedSong {
  item = item || {}
  const mid = item.mid || item.songmid || item.id || ''
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: item.id || item.docid || '',
    mid,
    songmid: mid,
    name: item.name || item.title || '',
    artist: item.singer || '',
    artists: item.singer ? [{ name: item.singer }] : [],
    album: '',
    cover: '',
    duration: 0,
    fee: 0,
    playable: false,
  }
}

export function mapQQTrack(track: any, fallback?: Partial<UnifiedSong>): UnifiedSong {
  track = track || {}
  const fb: any = fallback || {}
  const album = track.album || {}
  const artists = mapQQArtists(track.singer || [])
  const mid = track.mid || fb.mid || fb.songmid || ''
  const albumMid = album.mid || album.pmid || ''
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: track.id || fb.qqId || fb.id || '',
    mid,
    songmid: mid,
    mediaMid: (track.file && track.file.media_mid) || track.strMediaMid || track.media_mid || '',
    name: track.name || track.title || fb.name || '',
    artist: artists.map((a) => a.name).join(' / ') || fb.artist || '',
    artists: artists.length ? artists : fb.artists || [],
    artistId: artists[0] && (artists[0].id || artists[0].mid),
    artistMid: artists[0] && artists[0].mid,
    album: album.name || album.title || fb.album || '',
    albumMid,
    cover: qqAlbumCover(albumMid, 300) || fb.cover || '',
    duration: (Number(track.interval) || 0) * 1000,
    fee: track.pay && Number(track.pay.pay_play) ? 1 : 0,
    playable: false,
  }
}

export function mapQQPlaylistTrack(raw: any): UnifiedSong {
  raw = raw || {}
  const track =
    raw.songid || raw.songmid || raw.mid || raw.name
      ? raw
      : raw.track_info || raw.songInfo || raw.songinfo || raw.song || {}
  const album = track.album || {}
  const artists = mapQQArtists(track.singer || track.singers || [])
  const mid = track.mid || track.songmid || raw.mid || raw.songmid || ''
  const albumMid = album.mid || track.albummid || raw.albummid || ''
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid || String(track.id || track.songid || raw.id || raw.songid || ''),
    qqId: track.id || track.songid || raw.id || raw.songid || '',
    mid,
    songmid: mid,
    mediaMid: (track.file && track.file.media_mid) || track.strMediaMid || track.media_mid || raw.strMediaMid || '',
    name: track.name || track.songname || raw.songname || '',
    artist: artists.map((a) => a.name).join(' / ') || track.singername || raw.singername || '',
    artists,
    artistId: artists[0] && (artists[0].id || artists[0].mid),
    artistMid: artists[0] && artists[0].mid,
    album: album.name || album.title || track.albumname || raw.albumname || '',
    albumMid,
    cover: qqAlbumCover(albumMid, 300),
    duration: (Number(track.interval || raw.interval) || 0) * 1000,
    fee: track.pay && Number(track.pay.pay_play) ? 1 : 0,
    playable: false,
  }
}

export function mapQQPlaylist(pl: any, kind?: string): UnifiedPlaylist {
  pl = pl || {}
  const id = pl.dissid || pl.tid || pl.dirid || pl.id || pl.diss_id
  return {
    provider: 'qq',
    source: 'qq',
    id: id ? String(id) : '',
    name: pl.diss_name || pl.name || pl.title || '',
    cover: pl.diss_cover || pl.logo || pl.picurl || pl.cover || '',
    trackCount: pl.song_cnt || pl.songnum || pl.total_song_num || pl.song_count || 0,
    playCount: pl.listen_num || pl.visitnum || pl.play_count || 0,
    creator: pl.hostname || pl.nick || pl.creator || 'QQ 音乐',
    subscribed: kind === 'collect',
    specialType: 0,
  }
}

export function mapQQComment(raw: any): any {
  raw = raw || {}
  const user = raw.user || raw.uin || {}
  const nickname =
    raw.nick || raw.nickname || raw.encrypt_uin || user.nick || user.nickname || user.name || 'QQ 音乐用户'
  const avatar = raw.avatarurl || raw.avatar || user.avatarurl || user.avatar || ''
  const timeRaw = Number(raw.time || raw.commenttime || raw.createTime || 0) || 0
  return {
    id: raw.commentid || raw.commentId || raw.id || '',
    content: raw.rootcommentcontent || raw.content || raw.comment || '',
    likedCount: Number(raw.praisenum || raw.praise_num || raw.likedCount || 0) || 0,
    time: timeRaw && timeRaw < 10000000000 ? timeRaw * 1000 : timeRaw,
    user: {
      id: raw.encrypt_uin || raw.uin || user.uin || '',
      nickname,
      avatar,
    },
  }
}

export function isQQFavoritePlaylist(pl: any): boolean {
  const name = String((pl && pl.name) || '').trim()
  return /我喜欢|我的喜欢|喜欢的音乐/i.test(name)
}

export function isQzoneBackgroundPlaylist(pl: any): boolean {
  const text = String(((pl && pl.name) || '') + ' ' + ((pl && pl.creator) || '')).toLowerCase()
  return /qzone|空间|背景音乐/i.test(text)
}

export function decodeHtmlEntities(text: unknown): string {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
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
  const looksBase64 = compact.length >= 8 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  if (looksBase64 && !/^\s*\[/.test(raw)) {
    try {
      const decoded = Buffer.from(compact, 'base64').toString('utf8').replace(/^\uFEFF/, '')
      if (decoded && (decoded.includes('[') || /[一-龥]/.test(decoded))) raw = decoded
    } catch (e: any) {
      console.warn('[QQLyric] base64 decode failed:', e.message)
    }
  }
  return decodeHtmlEntities(raw).replace(/\r\n/g, '\n').trim()
}

export function normalizeQQSongId(id: unknown): number {
  const n = String(id || '').replace(/\D/g, '')
  return n ? Number(n) : 0
}

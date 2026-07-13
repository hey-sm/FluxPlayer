import { Hono } from 'hono'
import type { NeteaseProvider } from '../providers/netease'

/** 网易云域路由 —— 路径与响应形状与旧 server.js 完全兼容 */
export function registerNeteaseRoutes(app: Hono, netease: NeteaseProvider): void {
  app.get('/api/search', async (c) => {
    try {
      const kw = c.req.query('keywords') || ''
      const limit = parseInt(c.req.query('limit') || '20', 10) || 20
      const songs = await netease.search(kw, limit)
      return c.json({ songs })
    } catch (err: any) {
      console.error('[Search]', err)
      return c.json({ error: err.message, songs: [] }, 500)
    }
  })

  app.get('/api/song/url', async (c) => {
    try {
      const sid = c.req.query('id') || ''
      const quality = c.req.query('quality') || ''
      const loginInfo = await netease.loginInfo()
      const info = await netease.songUrl(sid, loginInfo, quality)
      return c.json({
        ...info,
        loggedIn: loginInfo.loggedIn,
        vipType: loginInfo.vipType || 0,
        vipLevel: loginInfo.vipLevel || 'none',
        isVip: !!loginInfo.isVip,
        isSvip: !!loginInfo.isSvip,
        vipLabel: loginInfo.vipLabel || '无VIP',
      })
    } catch (err: any) {
      console.error('[SongUrl]', err)
      return c.json({ error: err.message }, 500)
    }
  })

  app.get('/api/lyric', async (c) => {
    try {
      const id = c.req.query('id')
      if (!id) return c.json({ error: 'Missing song id', lyric: '' }, 400)
      return c.json(await netease.lyric(id))
    } catch (err: any) {
      console.error('[Lyric]', err)
      return c.json({ error: err.message, lyric: '' }, 500)
    }
  })

  app.get('/api/login/status', async (c) => c.json(await netease.loginInfo()))

  app.all('/api/logout', async (c) => {
    await netease.logout()
    return c.json({ ok: true })
  })

  app.get('/api/login/qr/key', async (c) => {
    try {
      return c.json(await netease.loginQrKey())
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  app.get('/api/login/qr/create', async (c) => {
    try {
      return c.json(await netease.loginQrCreate(c.req.query('key') || ''))
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  app.get('/api/login/qr/check', async (c) => {
    try {
      return c.json(await netease.loginQrCheck(c.req.query('key') || ''))
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  app.all('/api/login/cookie', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}) as any)
      const raw = body.cookie || body.data || body.text || ''
      netease.saveCookie(raw)
      if (!/(^|;\s*)MUSIC_U=/.test(netease.cookie)) {
        netease.saveCookie('')
        return c.json({ loggedIn: false, error: 'INVALID_NETEASE_COOKIE', message: '网易云 cookie 缺少 MUSIC_U' }, 400)
      }
      let info = await netease.loginInfo()
      if (!info.loggedIn && netease.cookie) {
        info = {
          loggedIn: true,
          pendingProfile: true,
          nickname: '网易云用户',
          avatar: '',
          vipType: 0,
          vipLevel: 'none',
          isVip: false,
          isSvip: false,
          vipLabel: '无VIP',
        }
      }
      return c.json({ ...info, saved: true, hasCookie: !!netease.cookie })
    } catch (err: any) {
      console.error('[LoginCookie]', err)
      return c.json({ loggedIn: false, error: err.message }, 500)
    }
  })

  app.get('/api/user/playlists', async (c) => {
    try {
      const limit = Math.max(12, Math.min(100, parseInt(c.req.query('limit') || '60', 10) || 60))
      return c.json(await netease.userPlaylists(limit))
    } catch (err: any) {
      console.error('[UserPlaylists]', err)
      return c.json({ error: err.message, loggedIn: false, playlists: [] }, 500)
    }
  })

  app.get('/api/user/liked/tracks', async (c) => {
    try {
      const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)
      const limit = Math.max(1, Math.min(200, parseInt(c.req.query('limit') || '100', 10) || 100))
      const result = await netease.likedTracks(offset, limit)
      if (result.error === 'LOGIN_REQUIRED') return c.json(result, 401)
      return c.json(result)
    } catch (err: any) {
      console.error('[LikedTracks]', err)
      return c.json(
        {
          provider: 'netease',
          error: 'LIKED_TRACKS_UNAVAILABLE',
          message: err.message,
          tracks: [],
        },
        502,
      )
    }
  })

  app.get('/api/playlist/tracks', async (c) => {
    try {
      const id = c.req.query('id')
      if (!id) return c.json({ error: 'Missing playlist id', tracks: [] }, 400)
      return c.json(await netease.playlistTracks(id))
    } catch (err: any) {
      console.error('[PlaylistTracks]', err)
      return c.json({ error: err.message, tracks: [] }, 500)
    }
  })

  app.get('/api/discover/home', async (c) => {
    try {
      return c.json(await netease.discoverHome())
    } catch (err: any) {
      console.error('[DiscoverHome]', err)
      return c.json({ error: err.message, loggedIn: false, dailySongs: [], playlists: [], podcasts: [] }, 500)
    }
  })

  app.get('/api/artist/detail', async (c) => {
    try {
      const id = c.req.query('id')
      const limit = Math.max(10, Math.min(80, parseInt(c.req.query('limit') || '30', 10) || 30))
      if (!id) return c.json({ error: 'Missing artist id', songs: [] }, 400)
      return c.json(await netease.artistDetail(id, limit))
    } catch (err: any) {
      console.error('[ArtistDetail]', err)
      return c.json({ error: err.message, songs: [] }, 500)
    }
  })

  app.get('/api/song/comments', async (c) => {
    try {
      const id = c.req.query('id')
      const limit = Math.max(6, Math.min(50, parseInt(c.req.query('limit') || '20', 10) || 20))
      const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)
      if (!id) return c.json({ error: 'Missing song id', comments: [] }, 400)
      return c.json(await netease.songComments(id, limit, offset))
    } catch (err: any) {
      console.error('[SongComments]', err)
      return c.json({ error: err.message, comments: [] }, 500)
    }
  })

  app.get('/api/song/like/check', async (c) => {
    try {
      const info = await netease.loginInfo()
      if (!info.loggedIn || !info.userId) return c.json({ error: 'LOGIN_REQUIRED', loggedIn: false }, 401)
      const ids = String(c.req.query('ids') || c.req.query('id') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (!ids.length) return c.json({ error: 'Missing song id', liked: {}, ids: [] }, 400)
      return c.json(await netease.likeCheck(ids, info))
    } catch (err: any) {
      console.error('[LikeCheck]', err)
      return c.json({ error: err.message }, 500)
    }
  })

  app.all('/api/song/like', async (c) => {
    try {
      const info = await netease.loginInfo()
      if (!info.loggedIn || !info.userId) return c.json({ error: 'LOGIN_REQUIRED', loggedIn: false }, 401)
      const body = c.req.method === 'POST' ? await c.req.json().catch(() => ({}) as any) : ({} as any)
      const id = body.id || c.req.query('id')
      const nextLike = String(body.like != null ? body.like : c.req.query('like') || 'true') !== 'false'
      if (!id) return c.json({ error: 'Missing song id' }, 400)
      return c.json(await netease.like(id, nextLike))
    } catch (err: any) {
      console.error('[Like]', err)
      return c.json({ error: err.message }, 500)
    }
  })

  app.all('/api/playlist/create', async (c) => {
    try {
      const info = await netease.loginInfo()
      if (!info.loggedIn || !info.userId) return c.json({ error: 'LOGIN_REQUIRED', loggedIn: false }, 401)
      const body = c.req.method === 'POST' ? await c.req.json().catch(() => ({}) as any) : ({} as any)
      const name = String(body.name || c.req.query('name') || '').trim()
      const privacy = String(body.privacy || c.req.query('privacy') || '0')
      if (!name) return c.json({ error: 'Missing playlist name' }, 400)
      return c.json(await netease.playlistCreate(name, privacy))
    } catch (err: any) {
      console.error('[PlaylistCreate]', err)
      return c.json({ error: err.message }, 500)
    }
  })

  app.all('/api/playlist/add-song', async (c) => {
    try {
      const info = await netease.loginInfo()
      if (!info.loggedIn || !info.userId) return c.json({ error: 'LOGIN_REQUIRED', loggedIn: false }, 401)
      const body = c.req.method === 'POST' ? await c.req.json().catch(() => ({}) as any) : ({} as any)
      const pid = body.pid || c.req.query('pid')
      const id = body.id || body.ids || c.req.query('id') || c.req.query('ids')
      if (!pid || !id) return c.json({ error: 'Missing playlist id or song id' }, 400)
      const r = await netease.playlistAddSong(String(pid), String(id))
      if (!r.success) {
        return c.json(
          {
            loggedIn: true,
            pid,
            id,
            success: false,
            code: r.finalCode,
            error: r.finalMessage || 'PLAYLIST_ADD_FAILED',
            attempts: r.attempts,
          },
          r.finalCode === 401 ? 401 : 409,
        )
      }
      return c.json({ loggedIn: true, pid, id, success: true, code: r.finalCode, body: r.finalBody, attempts: r.attempts })
    } catch (err: any) {
      console.error('[PlaylistAddSong]', err)
      return c.json({ error: err.message }, 500)
    }
  })
}

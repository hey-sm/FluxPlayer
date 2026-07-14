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

}

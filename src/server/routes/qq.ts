import { Hono } from 'hono'
import type { QQProvider } from '../providers/qq'

/** QQ 音乐域路由 —— 路径与响应形状与旧 server.js 完全兼容 */
export function registerQQRoutes(app: Hono, qq: QQProvider): void {
  app.get('/api/qq/search', async (c) => {
    try {
      const kw = c.req.query('keywords') || ''
      const limit = Math.max(4, Math.min(12, parseInt(c.req.query('limit') || '8', 10) || 8))
      const songs = await qq.search(kw, limit)
      return c.json({ provider: 'qq', songs })
    } catch (err: any) {
      console.error('[QQSearch]', err)
      return c.json({ provider: 'qq', error: err.message, songs: [] }, 500)
    }
  })

  app.get('/api/qq/song/url', async (c) => {
    try {
      const mid = c.req.query('mid') || c.req.query('id') || ''
      const mediaMid = c.req.query('mediaMid') || c.req.query('media_mid') || ''
      const quality = c.req.query('quality') || ''
      return c.json(await qq.songUrl(mid, mediaMid, quality))
    } catch (err: any) {
      console.error('[QQSongUrl]', err)
      return c.json({ provider: 'qq', url: '', playable: false, error: err.message }, 500)
    }
  })

  app.get('/api/qq/lyric', async (c) => {
    try {
      const mid = c.req.query('mid') || c.req.query('songmid') || ''
      const id = c.req.query('id') || c.req.query('qqId') || ''
      if (!mid && !id) return c.json({ provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' }, 400)
      return c.json(await qq.lyric(mid, id))
    } catch (err: any) {
      console.error('[QQLyric]', err)
      return c.json({ provider: 'qq', error: err.message, lyric: '' }, 500)
    }
  })

  app.get('/api/qq/login/status', async (c) => {
    try {
      return c.json(await qq.loginInfo())
    } catch (err: any) {
      console.error('[QQLoginStatus]', err)
      return c.json({ provider: 'qq', loggedIn: false, error: err.message }, 500)
    }
  })

  app.all('/api/qq/login/cookie', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}) as any)
      const raw = body.cookie || body.data || body.text || ''
      const result = qq.acceptCookieInput(raw)
      if (!result.ok) {
        return c.json(
          { provider: 'qq', loggedIn: false, error: 'INVALID_QQ_COOKIE', message: 'QQ cookie 缺少 uin 或有效登录票据' },
          400,
        )
      }
      const info = await qq.loginInfo()
      return c.json({ ...info, saved: true })
    } catch (err: any) {
      console.error('[QQLoginCookie]', err)
      return c.json({ provider: 'qq', loggedIn: false, error: err.message }, 500)
    }
  })

  app.all('/api/qq/logout', (c) => {
    qq.logout()
    return c.json({ provider: 'qq', ok: true, loggedIn: false })
  })

  app.get('/api/qq/user/playlists', async (c) => {
    try {
      return c.json(await qq.userPlaylists())
    } catch (err: any) {
      console.error('[QQUserPlaylists]', err)
      return c.json({ provider: 'qq', loggedIn: false, error: err.message, playlists: [] }, 500)
    }
  })

  app.get('/api/qq/user/liked/tracks', async (c) => {
    try {
      const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)
      const limit = Math.max(1, Math.min(200, parseInt(c.req.query('limit') || '100', 10) || 100))
      const result = await qq.likedTracks(offset, limit)
      if (result.error === 'LOGIN_REQUIRED') return c.json(result, 401)
      if (result.error) return c.json(result, 502)
      return c.json(result)
    } catch (err: any) {
      console.error('[QQLikedTracks]', err)
      return c.json(
        {
          provider: 'qq',
          error: 'LIKED_TRACKS_UNAVAILABLE',
          message: err.message,
          tracks: [],
        },
        502,
      )
    }
  })

  app.get('/api/qq/playlist/tracks', async (c) => {
    try {
      const id = c.req.query('id') || c.req.query('disstid') || ''
      return c.json(await qq.playlistTracks(id))
    } catch (err: any) {
      console.error('[QQPlaylistTracks]', err)
      return c.json({ provider: 'qq', error: err.message, tracks: [] }, 500)
    }
  })

}

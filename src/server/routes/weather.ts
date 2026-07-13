import { Hono } from 'hono'
import type { NeteaseProvider } from '../providers/netease'
import { buildWeatherRadio, fetchIpWeatherLocation } from '../weather'

/** 天气电台路由 —— 路径与响应形状与旧 server.js 完全兼容 */
export function registerWeatherRoutes(app: Hono, netease: NeteaseProvider): void {
  app.get('/api/weather/radio', async (c) => {
    try {
      const data = await buildWeatherRadio(
        {
          city: c.req.query('city') || c.req.query('q') || '',
          lat: c.req.query('lat'),
          lon: c.req.query('lon'),
          timezone: c.req.query('timezone') || '',
        },
        (keywords, limit) => netease.search(keywords, limit),
      )
      return c.json(data)
    } catch (err: any) {
      console.error('[WeatherRadio]', err)
      return c.json(
        {
          ok: false,
          error: err.message,
          weather: null,
          radio: { title: '天气电台', subtitle: '天气暂时没有回来，可以先听今日推荐。', seedQueries: [], songs: [] },
        },
        500,
      )
    }
  })

  app.get('/api/weather/ip-location', async (c) => {
    try {
      return c.json({ ok: true, location: await fetchIpWeatherLocation() })
    } catch (err: any) {
      console.error('[WeatherIpLocation]', err)
      return c.json({ ok: false, error: err.message, location: null }, 500)
    }
  })
}

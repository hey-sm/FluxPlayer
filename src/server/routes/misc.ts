import { Hono } from 'hono'
import type { ServerConfig } from '../types'

export function registerMiscRoutes(app: Hono, config: ServerConfig): void {
  app.get('/api/app/version', (c) =>
    c.json({ name: 'fluxplayer', productName: 'FluxPlayer', version: config.appVersion }),
  )
}

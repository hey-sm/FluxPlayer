import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { IPC } from '@shared/ipc-contract'
import { APP_ENTRY_URL, APP_ORIGIN, PRODUCTION_CSP } from '../../src/main/protocols/constants'

const projectFile = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')

const projectPathExists = (relativePath: string): boolean =>
  existsSync(new URL(`../../${relativePath}`, import.meta.url))

describe('Electron application boundary', () => {
  it('has no Hono, legacy HTTP server, Vite API proxy, or local TCP listener', () => {
    const packageJson = JSON.parse(projectFile('package.json')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies }
    expect(dependencies).not.toHaveProperty('hono')
    expect(dependencies).not.toHaveProperty('@hono/node-server')

    for (const legacyPath of [
      'src/server/index.ts',
      'src/server/routes',
      'src/server/proxy.ts',
      'src/server/static.ts',
    ]) {
      expect(projectPathExists(legacyPath), `legacy server path must be absent: ${legacyPath}`).toBe(false)
    }

    const mainSource = projectFile('src/main/index.ts')
    const viteSource = projectFile('electron.vite.config.ts')
    expect(mainSource).not.toMatch(/createServer|\.listen\s*\(|startServer|apiBase|43110/)
    expect(mainSource).not.toMatch(/from ['"](?:hono|@hono\/node-server)['"]/)
    expect(viteSource).not.toMatch(/['"]\/api['"]\s*:|proxy\s*:/)
  })

  it('uses flux://app for renderer assets and a restrictive production CSP', () => {
    expect(APP_ORIGIN).toBe('flux://app')
    expect(APP_ENTRY_URL).toBe('flux://app/index.html')
    expect(PRODUCTION_CSP).toContain("default-src 'self'")
    expect(PRODUCTION_CSP).toContain("connect-src 'self'")
    expect(PRODUCTION_CSP).toContain("img-src 'self' data: blob: flux-media: flux-background:")
    expect(PRODUCTION_CSP).toContain("media-src 'self' blob: flux-media: flux-background:")
    expect(PRODUCTION_CSP).not.toMatch(/https?:|localhost|127\.0\.0\.1|\*/)

    const protocolSource = projectFile('src/main/protocols/index.ts')
    const staticProtocolSource = projectFile('src/main/protocols/static-assets.ts')
    expect(protocolSource).toContain('protocol.handle(APP_SCHEME')
    expect(protocolSource).toContain('protocol.handle(MEDIA_SCHEME')
    expect(staticProtocolSource).toContain("'Content-Security-Policy': PRODUCTION_CSP")

    const rendererHtml = projectFile('src/renderer/index.html')
    expect(rendererHtml).toContain('flux-media:')
    expect(rendererHtml).not.toMatch(/https?:\/\/|\/api\//)
  })

  it('exposes music only through typed flux:* IPC channels', () => {
    const musicChannels = [
      IPC.musicSearch,
      IPC.musicResolvePlayback,
      IPC.musicGetLyrics,
      IPC.musicGetAuthStatus,
      IPC.musicLogin,
      IPC.musicLogout,
      IPC.musicGetPlaylists,
      IPC.musicGetPlaylistTracks,
      IPC.musicGetLikedTracks,
    ]
    expect(new Set(musicChannels).size).toBe(musicChannels.length)
    expect(musicChannels.every((channel) => channel.startsWith('flux:music:'))).toBe(true)

    const preloadSource = projectFile('src/preload/main.ts')
    const ipcSource = projectFile('src/main/ipc.ts')
    for (const key of [
      'musicSearch',
      'musicResolvePlayback',
      'musicGetLyrics',
      'musicGetAuthStatus',
      'musicLogin',
      'musicLogout',
      'musicGetPlaylists',
      'musicGetPlaylistTracks',
      'musicGetLikedTracks',
    ]) {
      expect(preloadSource).toContain(`IPC.${key}`)
      expect(ipcSource).toContain(`IPC.${key}`)
    }
    expect(preloadSource).toContain("contextBridge.exposeInMainWorld('fluxDesktop', api)")
    expect(preloadSource).not.toMatch(/apiBase|fetch\s*\(|\/api\//)
    expect(ipcSource).toContain('secureHandle(')
    expect(ipcSource).toContain('musicSearchRequestSchema')
    expect(ipcSource).toContain('playbackResolveRequestSchema')
  })
})

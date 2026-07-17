import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../src/shared/ipc-contract'
import { AudioHandleStore } from '../../src/main/protocols/media'

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const fromWebContents = vi.fn()
  return { handlers, fromWebContents }
})

vi.mock('electron', () => ({
  BrowserWindow: class MockBrowserWindow {
    static fromWebContents = electronMock.fromWebContents
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      electronMock.handlers.set(channel, handler),
  },
  globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  screen: { getAllDisplays: vi.fn(), getPrimaryDisplay: vi.fn(), getDisplayMatching: vi.fn() },
  shell: { openExternal: vi.fn() },
  session: { fromPartition: vi.fn() },
}))

import {
  normalizeRendererOrigin,
  registerIpcHandlers,
  type IpcDeps,
  type MainMusicService,
} from '../../src/main/ipc'

function fixture() {
  const frame = { url: 'flux://app/index.html', isDestroyed: () => false }
  const webContents = { mainFrame: frame, send: vi.fn() }
  const win = { isDestroyed: () => false, webContents, minimize: vi.fn() }
  electronMock.fromWebContents.mockReturnValue(win)
  const music = {
    search: vi.fn(async (request) => ({ provider: request.provider, songs: [] })),
    resolvePlayback: vi.fn(),
    getLyrics: vi.fn(),
    getAuthStatus: vi.fn(),
    authenticate: vi.fn(),
    logout: vi.fn(),
    getPlaylists: vi.fn(),
    getPlaylistTracks: vi.fn(),
    getLikedTracks: vi.fn(),
  } as unknown as MainMusicService
  const deps = {
    getMainWindow: () => win,
    getPrimaryRendererOrigin: () => 'flux://app/index.html',
    getMusicService: () => music,
    audioHandles: new AudioHandleStore(),
    getCustomBackgroundService: vi.fn(),
    getUpdaterController: () => null,
    getUpdaterFallbackState: vi.fn(() => ({})),
    requestQuit: vi.fn(),
    restartApp: vi.fn(),
  } as unknown as IpcDeps
  registerIpcHandlers(deps)
  return {
    frame,
    webContents,
    win,
    music,
    event: { sender: webContents, senderFrame: frame },
  }
}

beforeEach(() => {
  electronMock.handlers.clear()
  electronMock.fromWebContents.mockReset()
})

describe('secure Electron IPC', () => {
  it('accepts only the primary main frame and parses music input', async () => {
    const state = fixture()
    const handler = electronMock.handlers.get(IPC.musicSearch)
    await expect(
      handler?.(state.event, { provider: 'netease', keywords: 'test', limit: 10 }),
    ).resolves.toEqual({ provider: 'netease', songs: [] })
    expect(state.music.search).toHaveBeenCalledWith({ provider: 'netease', keywords: 'test', limit: 10 })
  })

  it('rejects invalid schema input before calling the service', async () => {
    const state = fixture()
    const handler = electronMock.handlers.get(IPC.musicSearch)
    await expect(handler?.(state.event, { provider: 'invalid', keywords: '' })).rejects.toThrow(
      'INVALID_REQUEST',
    )
    expect(state.music.search).not.toHaveBeenCalled()
  })

  it('rejects a subframe, wrong origin, or foreign sender window', async () => {
    const state = fixture()
    const handler = electronMock.handlers.get(IPC.musicSearch)
    const payload = { provider: 'qq', keywords: 'test' }

    await expect(
      handler?.({ sender: state.webContents, senderFrame: { ...state.frame } }, payload),
    ).rejects.toThrow('UNAUTHORIZED_RENDERER')

    state.frame.url = 'https://evil.example/'
    await expect(handler?.(state.event, payload)).rejects.toThrow('UNAUTHORIZED_RENDERER')

    state.frame.url = 'flux://app/index.html'
    electronMock.fromWebContents.mockReturnValue({ webContents: state.webContents })
    await expect(handler?.(state.event, payload)).rejects.toThrow('UNAUTHORIZED_RENDERER')
    expect(state.music.search).not.toHaveBeenCalled()
  })

  it('normalizes only trustworthy renderer origins', () => {
    expect(normalizeRendererOrigin('flux://app/index.html')).toBe('flux://app')
    expect(normalizeRendererOrigin('flux://app/assets/app.js?cache=1')).toBe('flux://app')
    expect(normalizeRendererOrigin('http://127.0.0.1:5173/index.html')).toBe('http://127.0.0.1:5173')

    for (const url of [
      'flux://app.evil.example/index.html',
      'flux://user@app/index.html',
      'flux://app:443/index.html',
      'file:///index.html',
      'not a url',
    ]) {
      expect(normalizeRendererOrigin(url), url).toBeNull()
    }
  })

  it('rejects missing, destroyed, spoofed, and non-main frames', async () => {
    const payload = { provider: 'qq', keywords: 'test' }

    {
      const state = fixture()
      const handler = electronMock.handlers.get(IPC.musicSearch)
      await expect(handler?.({ sender: state.webContents, senderFrame: null }, payload)).rejects.toThrow(
        'UNAUTHORIZED_RENDERER',
      )
      expect(state.music.search).not.toHaveBeenCalled()
    }

    {
      const state = fixture()
      const handler = electronMock.handlers.get(IPC.musicSearch)
      state.frame.isDestroyed = () => true
      await expect(handler?.(state.event, payload)).rejects.toThrow('UNAUTHORIZED_RENDERER')
      expect(state.music.search).not.toHaveBeenCalled()
    }

    {
      const state = fixture()
      const handler = electronMock.handlers.get(IPC.musicSearch)
      const foreignSender = { mainFrame: state.frame }
      electronMock.fromWebContents.mockReturnValue(state.win)
      await expect(handler?.({ sender: foreignSender, senderFrame: state.frame }, payload)).rejects.toThrow(
        'UNAUTHORIZED_RENDERER',
      )
      expect(state.music.search).not.toHaveBeenCalled()
    }

    {
      const state = fixture()
      const handler = electronMock.handlers.get(IPC.musicSearch)
      electronMock.fromWebContents.mockReturnValue(null)
      await expect(handler?.(state.event, payload)).rejects.toThrow('UNAUTHORIZED_RENDERER')
      expect(state.music.search).not.toHaveBeenCalled()
    }
  })
})

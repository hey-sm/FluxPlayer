import { BrowserWindow, dialog, globalShortcut, ipcMain } from 'electron'
import * as z from 'zod/mini'
import { IPC, type HotkeyBinding, type HotkeyConfigureResult } from '@shared/ipc-contract'
import type {
  FluxMusicApi,
  LikedTracksRequest,
  LikedTracksResult,
  LyricDocument,
  LyricsRequest,
  MusicAuthResult,
  MusicSearchRequest,
  MusicSearchResult,
  PlaybackResolveRequest,
  PlaybackResolveResult,
  PlaylistListRequest,
  PlaylistListResult,
  PlaylistTracksRequest,
  PlaylistTracksResult,
} from '@shared/music-contract'
import {
  likedTracksRequestSchema,
  lyricsRequestSchema,
  musicSearchRequestSchema,
  playbackResolveRequestSchema,
  playlistListRequestSchema,
  playlistTracksRequestSchema,
  providerRequestSchema,
} from '@shared/music-schema'
import type { ProviderId } from '@shared/models'
import type { UpdaterCommandResult, UpdaterState } from '@shared/updater-contract'
import type { WallpaperEngineImportRequest } from '@shared/custom-background-contract'
import type { CustomBackgroundService } from './background/custom-background'
import type { AudioHandleStore } from './protocols'
import { exitFullscreenToWindow, getWindowState, toggleFullscreen } from './windows/main-window'
import {
  clearNeteaseMusicLoginSession,
  clearQQMusicLoginSession,
  openNeteaseMusicLoginWindow,
  openQQMusicLoginWindow,
} from './windows/login-windows'
import type { UpdaterController } from './updater'

const registeredGlobalHotkeys = new Map<string, string>()
const noInputSchema = z.undefined()
const hotkeyBindingsSchema = z.array(
  z.object({
    action: z.string().check(z.minLength(1), z.maxLength(100)),
    accelerator: z.string().check(z.minLength(1), z.maxLength(100)),
  }),
)
const wallpaperImportSchema = z.object({ projectId: z.string().check(z.minLength(1), z.maxLength(200)) })

export interface MainPlaybackResolution extends Omit<PlaybackResolveResult, 'url'> {
  /** Upstream URL. It exists only in main and is exchanged for an opaque flux-media handle. */
  upstreamUrl: string | null
  upstreamHeaders?: Readonly<Record<string, string>>
}

/** Adapter boundary implemented by the provider/main music-service integration. */
export interface MainMusicService extends Omit<FluxMusicApi, 'resolvePlayback' | 'login'> {
  resolvePlayback(request: PlaybackResolveRequest): Promise<MainPlaybackResolution>
  authenticate(provider: ProviderId, cookie: string): Promise<MusicAuthResult>
}

export interface IpcDeps {
  getMainWindow: () => BrowserWindow | null
  getPrimaryRendererOrigin: () => string
  getCustomBackgroundService: () => CustomBackgroundService
  getUpdaterController: () => UpdaterController | null
  getUpdaterFallbackState: () => UpdaterState
  getMusicService: () => MainMusicService
  audioHandles: AudioHandleStore
  requestQuit: () => void
  restartApp: () => Promise<void>
}

function getSenderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

export function normalizeRendererOrigin(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'flux:' && url.hostname === 'app' && !url.port && !url.username && !url.password) {
      return 'flux://app'
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin
  } catch {
    // Invalid renderer URLs are untrusted.
  }
  return null
}

export function isPrimaryRenderer(event: Electron.IpcMainInvokeEvent, deps: IpcDeps): boolean {
  const mainWindow = deps.getMainWindow()
  const senderWindow = getSenderWindow(event)
  const frame = event.senderFrame
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !senderWindow ||
    senderWindow !== mainWindow ||
    event.sender !== mainWindow.webContents ||
    !frame ||
    frame !== event.sender.mainFrame ||
    frame.isDestroyed()
  ) {
    return false
  }
  const senderOrigin = normalizeRendererOrigin(frame.url)
  const expectedOrigin = normalizeRendererOrigin(deps.getPrimaryRendererOrigin())
  return senderOrigin !== null && expectedOrigin !== null && senderOrigin === expectedOrigin
}

function secureHandle<Input, Output>(
  channel: string,
  schema: { parse(input: unknown): Input },
  deps: IpcDeps,
  handler: (input: Input, event: Electron.IpcMainInvokeEvent) => Output | Promise<Output>,
): void {
  ipcMain.handle(channel, async (event, rawInput: unknown) => {
    if (!isPrimaryRenderer(event, deps)) throw new Error('UNAUTHORIZED_RENDERER')
    let input: Input
    try {
      input = schema.parse(rawInput)
    } catch {
      throw new Error('INVALID_REQUEST')
    }
    return handler(input, event)
  })
}

function sendGlobalHotkeyAction(getMainWindow: () => BrowserWindow | null, action: string): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || !action) return
  win.webContents.send(IPC.globalHotkey, { action })
}

export function unregisterGlobalHotkeys(): void {
  for (const accelerator of registeredGlobalHotkeys.keys()) {
    try {
      globalShortcut.unregister(accelerator)
    } catch {
      // A shutdown race must not block application exit.
    }
  }
  registeredGlobalHotkeys.clear()
}

function configureGlobalHotkeys(
  getMainWindow: () => BrowserWindow | null,
  bindings: HotkeyBinding[],
): HotkeyConfigureResult {
  unregisterGlobalHotkeys()
  const results: HotkeyConfigureResult['results'] = []
  const seen = new Set<string>()
  for (const item of bindings) {
    const action = item.action.trim()
    const accelerator = item.accelerator.trim()
    if (!action || !accelerator || seen.has(accelerator)) continue
    seen.add(accelerator)
    let registered = false
    try {
      registered = globalShortcut.register(accelerator, () => sendGlobalHotkeyAction(getMainWindow, action))
    } catch {
      registered = false
    }
    if (registered) {
      registeredGlobalHotkeys.set(accelerator, action)
      results.push({ action, accelerator, ok: true })
    } else {
      results.push({
        action,
        accelerator,
        ok: false,
        conflict: {
          sourceName: '系统 / 其他软件',
          sourceIcon: 'warning',
          reason: '该组合键已被占用或被系统保留',
        },
      })
    }
  }
  return { ok: true, results }
}

function unavailableUpdaterResult(deps: IpcDeps, code: string, message: string): UpdaterCommandResult {
  return { ok: false, state: deps.getUpdaterFallbackState(), error: { code, message } }
}

async function login(
  provider: ProviderId,
  deps: IpcDeps,
  event: Electron.IpcMainInvokeEvent,
): Promise<MusicAuthResult> {
  const owner = getSenderWindow(event)
  const loginResult =
    provider === 'netease' ? await openNeteaseMusicLoginWindow(owner) : await openQQMusicLoginWindow(owner)
  if (!loginResult.ok || !loginResult.cookie) {
    throw new Error(loginResult.cancelled ? 'AUTH_CANCELLED' : loginResult.error || 'INVALID_CREDENTIALS')
  }
  return deps.getMusicService().authenticate(provider, loginResult.cookie)
}

async function logout(provider: ProviderId, deps: IpcDeps): Promise<void> {
  await deps.getMusicService().logout(provider)
  if (provider === 'netease') await clearNeteaseMusicLoginSession()
  else await clearQQMusicLoginSession()
}

export function registerIpcHandlers(deps: IpcDeps): void {
  secureHandle(IPC.windowMinimize, noInputSchema, deps, () => deps.getMainWindow()?.minimize())
  secureHandle(IPC.windowToggleMaximize, noInputSchema, deps, () => toggleFullscreen(deps.getMainWindow()))
  secureHandle(IPC.windowToggleFullscreen, noInputSchema, deps, () => toggleFullscreen(deps.getMainWindow()))
  secureHandle(IPC.windowExitFullscreenWindowed, noInputSchema, deps, () =>
    exitFullscreenToWindow(deps.getMainWindow()),
  )
  secureHandle(IPC.windowGetState, noInputSchema, deps, () => getWindowState(deps.getMainWindow()))
  secureHandle(IPC.windowClose, noInputSchema, deps, () => deps.requestQuit())

  secureHandle(IPC.configureGlobalHotkeys, hotkeyBindingsSchema, deps, (bindings) =>
    configureGlobalHotkeys(deps.getMainWindow, bindings),
  )

  secureHandle(IPC.musicSearch, musicSearchRequestSchema, deps, (request) =>
    deps.getMusicService().search(request as MusicSearchRequest),
  )
  secureHandle(IPC.musicResolvePlayback, playbackResolveRequestSchema, deps, async (request) => {
    const resolution = await deps.getMusicService().resolvePlayback(request as PlaybackResolveRequest)
    const { upstreamUrl, upstreamHeaders, ...result } = resolution
    const url = upstreamUrl
      ? `flux-media://audio/${deps.audioHandles.create({ url: upstreamUrl, headers: upstreamHeaders })}`
      : null
    return { ...result, url } satisfies PlaybackResolveResult
  })
  secureHandle(IPC.musicGetLyrics, lyricsRequestSchema, deps, (request) =>
    deps.getMusicService().getLyrics(request as LyricsRequest),
  )
  secureHandle(IPC.musicGetAuthStatus, providerRequestSchema, deps, ({ provider }) =>
    deps.getMusicService().getAuthStatus(provider),
  )
  secureHandle(IPC.musicLogin, providerRequestSchema, deps, ({ provider }, event) =>
    login(provider, deps, event),
  )
  secureHandle(IPC.musicLogout, providerRequestSchema, deps, ({ provider }) => logout(provider, deps))
  secureHandle(IPC.musicGetPlaylists, playlistListRequestSchema, deps, (request) =>
    deps.getMusicService().getPlaylists(request as PlaylistListRequest),
  )
  secureHandle(IPC.musicGetPlaylistTracks, playlistTracksRequestSchema, deps, (request) =>
    deps.getMusicService().getPlaylistTracks(request as PlaylistTracksRequest),
  )
  secureHandle(IPC.musicGetLikedTracks, likedTracksRequestSchema, deps, (request) =>
    deps.getMusicService().getLikedTracks(request as LikedTracksRequest),
  )

  secureHandle(IPC.restartApp, noInputSchema, deps, async () => {
    try {
      await deps.restartApp()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'RESTART_FAILED' }
    }
  })

  secureHandle(
    IPC.updaterGetState,
    noInputSchema,
    deps,
    () => deps.getUpdaterController()?.getState() ?? deps.getUpdaterFallbackState(),
  )
  secureHandle(
    IPC.updaterCheck,
    noInputSchema,
    deps,
    () =>
      deps.getUpdaterController()?.check() ??
      unavailableUpdaterResult(deps, 'UPDATER_NOT_AVAILABLE', 'Updater is not available.'),
  )
  secureHandle(
    IPC.updaterDownload,
    noInputSchema,
    deps,
    () =>
      deps.getUpdaterController()?.download() ??
      unavailableUpdaterResult(deps, 'UPDATER_NOT_AVAILABLE', 'Updater is not available.'),
  )
  secureHandle(
    IPC.updaterInstall,
    noInputSchema,
    deps,
    () =>
      deps.getUpdaterController()?.install() ??
      unavailableUpdaterResult(deps, 'UPDATER_NOT_AVAILABLE', 'Updater is not available.'),
  )

  secureHandle(IPC.customBackgroundGet, noInputSchema, deps, () =>
    deps.getCustomBackgroundService().getCurrent(),
  )
  secureHandle(IPC.customBackgroundChooseFile, noInputSchema, deps, async () => {
    const owner = deps.getMainWindow() ?? undefined
    const choice = await dialog.showOpenDialog(owner as BrowserWindow, {
      title: '选择自定义背景',
      properties: ['openFile'],
      filters: [
        {
          name: '图片和视频',
          extensions: ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp', 'm4v', 'mov', 'mp4', 'webm'],
        },
      ],
    })
    if (choice.canceled || !choice.filePaths[0]) {
      return { ok: false, background: deps.getCustomBackgroundService().getCurrent(), canceled: true }
    }
    const result = deps.getCustomBackgroundService().importFile(choice.filePaths[0])
    if (result.ok) deps.getMainWindow()?.webContents.send(IPC.customBackgroundChanged, result.background)
    return result
  })
  secureHandle(IPC.customBackgroundClear, noInputSchema, deps, () => {
    const result = deps.getCustomBackgroundService().clear()
    if (result.ok) deps.getMainWindow()?.webContents.send(IPC.customBackgroundChanged, null)
    return result
  })
  secureHandle(IPC.customBackgroundScanWallpaperEngine, noInputSchema, deps, () =>
    deps.getCustomBackgroundService().scanWallpaperEngine(),
  )
  secureHandle(IPC.customBackgroundImportWallpaperEngine, wallpaperImportSchema, deps, (request) => {
    const result = deps
      .getCustomBackgroundService()
      .importScannedProject((request as WallpaperEngineImportRequest).projectId)
    if (result.ok) deps.getMainWindow()?.webContents.send(IPC.customBackgroundChanged, result.background)
    return result
  })
  secureHandle(IPC.customBackgroundChooseWallpaperEngine, noInputSchema, deps, async () => {
    const owner = deps.getMainWindow() ?? undefined
    const choice = await dialog.showOpenDialog(owner as BrowserWindow, {
      title: '导入 Wallpaper Engine 视频项目',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Wallpaper Engine project.json', extensions: ['json'] }],
    })
    if (choice.canceled || !choice.filePaths[0]) {
      return { ok: false, background: deps.getCustomBackgroundService().getCurrent(), canceled: true }
    }
    const result = deps.getCustomBackgroundService().importProjectPath(choice.filePaths[0])
    if (result.ok) deps.getMainWindow()?.webContents.send(IPC.customBackgroundChanged, result.background)
    return result
  })
}

// Exported type anchors make the provider adapter contract easy to implement without importing renderer code.
export type MainMusicServiceMethodResults = {
  search: MusicSearchResult
  lyrics: LyricDocument
  auth: MusicAuthResult
  playlists: PlaylistListResult
  playlistTracks: PlaylistTracksResult
  likedTracks: LikedTracksResult
}

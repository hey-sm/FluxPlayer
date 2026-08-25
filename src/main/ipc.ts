import { BrowserWindow, dialog, ipcMain } from 'electron'
import * as z from 'zod/mini'
import { IPC } from '@shared/ipc-contract'
import type {
  DiscoverRequest,
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
  chkszKeySchema,
  discoverRequestSchema,
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
import type { WallpaperEngineRuntimeStatus } from '@shared/wallpaper-engine-contract'
import type { WallpaperEngineLibrary } from './background/wallpaper-engine-library'
import type { WallpaperEngineStore } from './background/wallpaper-engine-store'
import type { WallpaperEngineRuntime } from './background/wallpaper-engine-runtime'
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

/**
 * IPC handler 注册器段落地图（行号随改动漂移，按符号定位更稳）：
 *   1. zod schema（~49-60）         本地 schema（壁纸引擎等），音乐 schema 来自 @shared/music-schema
 *   2. 安全工具（~62-173）          isWallpaperRuntimeSelectionActive / normalizeRendererOrigin /
 *                                  isPrimaryRenderer（拒绝非主窗口 / 非 main frame / origin 不符）/
 *                                  secureHandle（每个 handler 都经它：先校验 sender，再 zod 解析入参）
 *   3. 类型（~66-110）              MainPlaybackResolution / MainMusicService / IpcDeps
 *   4. registerIpcHandlers（~175-393）所有 ipcMain.handle 的集中注册，按能力分组：
 *      - 窗口（~176-183）           minimize / toggleMaximize / toggleFullscreen / exitFullscreenWindowed / getState / close
 *      - 音乐（~185-219）           search / resolvePlayback（唯一换 flux-media 句柄处）/ getLyrics /
 *                                  getAuthStatus / login / logout / getPlaylists / getPlaylistTracks /
 *                                  getLikedTracks / getDiscover
 *      - chksz 密钥（~221-234）     getKey / setKey / clearKey
 *      - 应用（~235-242）           restartApp
 *      - 更新器（~244-273）          getState / check / download / install
 *      - 自定义背景（~275-303）     get / chooseFile / clear（改完广播 customBackgroundChanged）
 *      - 壁纸引擎（~305-392）       list / chooseDirectory / chooseProjectFile / removeDirectory /
 *                                  projectDetails / getState / setState / runtimeStatus / glassSamplerPrepare / dwmActivate
 *   5. 类型锚点（~396-403）          MainMusicServiceMethodResults
 * 新增 IPC 必须经 secureHandle，schema 加在 @shared/music-schema.ts，通道常量加在 @shared/ipc-contract.ts。
 */

const noInputSchema = z.undefined()
const wallpaperEngineListSchema = z.object({ force: z.optional(z.boolean()) })
const wallpaperEngineIdSchema = z.object({ id: z.string().check(z.minLength(1), z.maxLength(64)) })
const wallpaperEngineStateSchema = z.object({
  action: z.string().check(z.minLength(1), z.maxLength(32)),
  id: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
  active: z.optional(z.boolean()),
  error: z.optional(z.string().check(z.maxLength(240))),
})
const wallpaperEngineGlassSamplerSchema = z.object({
  sessionId: z.string().check(z.minLength(1), z.maxLength(96)),
})

export function isWallpaperRuntimeSelectionActive(status: WallpaperEngineRuntimeStatus): boolean {
  return status.active || (status.ok && status.mode === 'dwm' && status.phase === 'starting')
}

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
  getWallpaperEngineLibrary: () => WallpaperEngineLibrary
  getWallpaperEngineStore: () => WallpaperEngineStore
  getWallpaperEngineRuntime: () => WallpaperEngineRuntime
  getUpdaterController: () => UpdaterController | null
  getUpdaterFallbackState: () => UpdaterState
  getMusicService: () => MainMusicService
  /** ChKSz 凭据存储：主进程持有，用于聚合 API 的透明解锁层。 */
  getCredentialStore: () => import('../server/types').CredentialStore
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
  secureHandle(IPC.musicGetDiscover, discoverRequestSchema, deps, (request) =>
    deps.getMusicService().getDiscover(request as DiscoverRequest),
  )

  // ChKSz 聚合 API 密钥管理：密钥在主进程加密存储，renderer 只看到是否存在、不拿到明文。
  // 配了密钥就自动生效——直连无音源/试听时自动兜底，无需手动开关。
  secureHandle(IPC.chkszGetKey, noInputSchema, deps, () => ({
    configured: Boolean(deps.getCredentialStore().get('chksz')),
  }))
  secureHandle(IPC.chkszSetKey, chkszKeySchema, deps, ({ key }) => {
    const trimmed = String(key || '').trim()
    if (!trimmed) throw new Error('INVALID_REQUEST')
    deps.getCredentialStore().set('chksz', trimmed)
    return { ok: true as const }
  })
  secureHandle(IPC.chkszClearKey, noInputSchema, deps, () => {
    deps.getCredentialStore().set('chksz', '')
    return { ok: true as const }
  })

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
  const broadcastWallpaperState = () => {
    deps
      .getMainWindow()
      ?.webContents.send(IPC.wallpaperEngineStateChanged, deps.getWallpaperEngineStore().get())
  }

  const reconcileWallpaperSelection = (projectIds: ReadonlySet<string>) => {
    const store = deps.getWallpaperEngineStore()
    const current = store.get()
    if (!current.selection.active || projectIds.has(current.selection.id)) return current
    const next = store.deactivateSelection(current.selection.id, 'WALLPAPER_ENGINE_PROJECT_OFFLINE')
    broadcastWallpaperState()
    return next
  }

  secureHandle(IPC.wallpaperEngineList, wallpaperEngineListSchema, deps, async ({ force }) => {
    const snapshot = await deps.getWallpaperEngineLibrary().list(force === true)
    const state = reconcileWallpaperSelection(new Set(snapshot.projects.map((project) => project.id)))
    if (!state.selection.active) await deps.getWallpaperEngineRuntime().stop()
    return { ...snapshot, state }
  })
  secureHandle(IPC.wallpaperEngineChooseDirectory, noInputSchema, deps, async () => {
    const owner = deps.getMainWindow() ?? undefined
    const result = await dialog.showOpenDialog(owner as BrowserWindow, {
      title: '识别并导入 Wallpaper Engine 项目目录',
      buttonLabel: '识别此目录',
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: true, canceled: true }
    const snapshot = await deps.getWallpaperEngineLibrary().addManualRoot(result.filePaths[0])
    return { ok: true, snapshot, state: deps.getWallpaperEngineStore().get() }
  })
  secureHandle(IPC.wallpaperEngineChooseProjectFile, noInputSchema, deps, async () => {
    const owner = deps.getMainWindow() ?? undefined
    const result = await dialog.showOpenDialog(owner as BrowserWindow, {
      title: '选择 Wallpaper Engine 的 project.json 或场景包',
      buttonLabel: '导入此项目',
      properties: ['openFile'],
      filters: [{ name: 'Wallpaper Engine 项目', extensions: ['json', 'pkg', 'pak'] }],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: true, canceled: true }
    const snapshot = await deps.getWallpaperEngineLibrary().addManualProjectFile(result.filePaths[0])
    return { ok: true, snapshot, state: deps.getWallpaperEngineStore().get() }
  })
  secureHandle(IPC.wallpaperEngineRemoveDirectory, wallpaperEngineIdSchema, deps, async ({ id }) => {
    const snapshot = await deps.getWallpaperEngineLibrary().removeManualRoot(id)
    return { ok: true, snapshot, state: deps.getWallpaperEngineStore().get() }
  })
  secureHandle(IPC.wallpaperEngineProjectDetails, wallpaperEngineIdSchema, deps, (request) =>
    deps.getWallpaperEngineLibrary().getProjectDetails(request.id),
  )
  secureHandle(IPC.wallpaperEngineGetState, noInputSchema, deps, () => deps.getWallpaperEngineStore().get())
  secureHandle(IPC.wallpaperEngineSetState, wallpaperEngineStateSchema, deps, async (request) => {
    const store = deps.getWallpaperEngineStore()
    const id = request.id ?? ''
    let state
    if (request.action === 'select') {
      const selection = await deps.getWallpaperEngineLibrary().resolveSelection(id)
      const project = await deps.getWallpaperEngineLibrary().getProject(id)
      const runtime = await deps.getWallpaperEngineRuntime().activate(project, selection)
      const selectionActive = isWallpaperRuntimeSelectionActive(runtime)
      state =
        runtime.projectId !== project.id
          ? store.get()
          : store.setSelection({ ...selection, active: selectionActive, runtimeError: runtime.error })
    } else if (request.action === 'clear') {
      await deps.getWallpaperEngineRuntime().stop()
      state = store.clearSelection()
    } else if (request.action === 'favorite') state = store.setFavorite(id, request.active === true)
    else if (request.action === 'hide') state = store.setProjectVisibility(id, true)
    else if (request.action === 'unhide') state = store.setProjectVisibility(id, false)
    else if (request.action === 'restore-hidden') state = store.clearHidden()
    else if (request.action === 'runtime-error') {
      await deps.getWallpaperEngineRuntime().stop()
      state = store.deactivateSelection(id, request.error || 'WALLPAPER_ENGINE_RUNTIME_FAILED')
    } else throw new Error('INVALID_WALLPAPER_ENGINE_STATE_ACTION')
    broadcastWallpaperState()
    return state
  })
  secureHandle(IPC.wallpaperEngineRuntimeStatus, noInputSchema, deps, () =>
    deps.getWallpaperEngineRuntime().getStatus(),
  )
  secureHandle(
    IPC.wallpaperEngineGlassSamplerPrepare,
    wallpaperEngineGlassSamplerSchema,
    deps,
    ({ sessionId }) => deps.getWallpaperEngineRuntime().prepareGlassSampler(sessionId),
  )
  secureHandle(IPC.wallpaperEngineDwmActivate, wallpaperEngineGlassSamplerSchema, deps, ({ sessionId }) =>
    deps.getWallpaperEngineRuntime().activateDwmSurface(sessionId),
  )
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

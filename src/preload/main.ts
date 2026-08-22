import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type DesktopWindowState } from '@shared/ipc-contract'
import type { FluxMusicApi } from '@shared/music-contract'
import type { PerfState } from '@shared/perf-state'
import type { CustomBackground, CustomBackgroundResult } from '@shared/custom-background-contract'
import type { UpdaterCommandResult, UpdaterState } from '@shared/updater-contract'
import type {
  WallpaperEngineCommandResult,
  WallpaperEngineLibrarySnapshot,
  WallpaperEngineProjectDetails,
  WallpaperEngineRuntimeStatus,
  WallpaperEngineState,
  WallpaperEngineStateCommand,
} from '@shared/wallpaper-engine-contract'

function bind<Payload>(channel: string, callback: (payload: Payload) => void): () => void {
  if (typeof callback !== 'function') return () => undefined
  const listener = (_event: Electron.IpcRendererEvent, payload: Payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const music: FluxMusicApi = {
  search: (request) => ipcRenderer.invoke(IPC.musicSearch, request),
  resolvePlayback: (request) => ipcRenderer.invoke(IPC.musicResolvePlayback, request),
  getLyrics: (request) => ipcRenderer.invoke(IPC.musicGetLyrics, request),
  getAuthStatus: (provider) => ipcRenderer.invoke(IPC.musicGetAuthStatus, { provider }),
  login: (provider) => ipcRenderer.invoke(IPC.musicLogin, { provider }),
  logout: (provider) => ipcRenderer.invoke(IPC.musicLogout, { provider }),
  getPlaylists: (request) => ipcRenderer.invoke(IPC.musicGetPlaylists, request),
  getPlaylistTracks: (request) => ipcRenderer.invoke(IPC.musicGetPlaylistTracks, request),
  getLikedTracks: (request) => ipcRenderer.invoke(IPC.musicGetLikedTracks, request),
  getDiscover: (request) => ipcRenderer.invoke(IPC.musicGetDiscover, request),
}

/** ChKSz 聚合 API 密钥管理：密钥在主进程加密存储，renderer 只能查询是否已配置。 */
const chksz = {
  getStatus: (): Promise<{ configured: boolean; enabled: boolean }> => ipcRenderer.invoke(IPC.chkszGetKey),
  setKey: (key: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.chkszSetKey, { key }),
  clearKey: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.chkszClearKey),
  setEnabled: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.chkszSetEnabled, { enabled }),
  onQuotaWarning: (callback: (payload: { title: string; message: string }) => void): (() => void) =>
    bind(IPC.chkszQuotaWarning, callback),
}

const api = {
  isDesktop: true as const,
  music,
  chksz,
  minimize: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),
  toggleMaximize: (): Promise<void> => ipcRenderer.invoke(IPC.windowToggleMaximize),
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke(IPC.windowToggleFullscreen),
  exitFullscreenWindowed: (): Promise<void> => ipcRenderer.invoke(IPC.windowExitFullscreenWindowed),
  getWindowState: (): Promise<DesktopWindowState> => ipcRenderer.invoke(IPC.windowGetState),
  close: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),
  onWindowState: (callback: (state: DesktopWindowState) => void): (() => void) =>
    bind(IPC.windowStateChanged, callback),
  onPerfState: (callback: (state: PerfState) => void): (() => void) => bind(IPC.perfStateChanged, callback),
  restartApp: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.restartApp),
  getUpdaterState: (): Promise<UpdaterState> => ipcRenderer.invoke(IPC.updaterGetState),
  checkForUpdates: (): Promise<UpdaterCommandResult> => ipcRenderer.invoke(IPC.updaterCheck),
  downloadUpdate: (): Promise<UpdaterCommandResult> => ipcRenderer.invoke(IPC.updaterDownload),
  installUpdate: (): Promise<UpdaterCommandResult> => ipcRenderer.invoke(IPC.updaterInstall),
  onUpdaterState: (callback: (payload: UpdaterState) => void): (() => void) =>
    bind(IPC.updaterStateChanged, callback),
  getCustomBackground: (): Promise<CustomBackground | null> => ipcRenderer.invoke(IPC.customBackgroundGet),
  chooseCustomBackgroundFile: (): Promise<CustomBackgroundResult> =>
    ipcRenderer.invoke(IPC.customBackgroundChooseFile),
  clearCustomBackground: (): Promise<CustomBackgroundResult> => ipcRenderer.invoke(IPC.customBackgroundClear),
  onCustomBackgroundChanged: (callback: (payload: CustomBackground | null) => void): (() => void) =>
    bind(IPC.customBackgroundChanged, callback),
  listWallpaperEngineProjects: (
    force = false,
  ): Promise<WallpaperEngineLibrarySnapshot & { state: WallpaperEngineState }> =>
    ipcRenderer.invoke(IPC.wallpaperEngineList, { force }),
  chooseWallpaperEngineDirectory: (): Promise<WallpaperEngineCommandResult> =>
    ipcRenderer.invoke(IPC.wallpaperEngineChooseDirectory),
  chooseWallpaperEngineProjectFile: (): Promise<WallpaperEngineCommandResult> =>
    ipcRenderer.invoke(IPC.wallpaperEngineChooseProjectFile),
  removeWallpaperEngineDirectory: (id: string): Promise<WallpaperEngineCommandResult> =>
    ipcRenderer.invoke(IPC.wallpaperEngineRemoveDirectory, { id }),
  getWallpaperEngineProjectDetails: (id: string): Promise<WallpaperEngineProjectDetails> =>
    ipcRenderer.invoke(IPC.wallpaperEngineProjectDetails, { id }),
  getWallpaperEngineState: (): Promise<WallpaperEngineState> =>
    ipcRenderer.invoke(IPC.wallpaperEngineGetState),
  setWallpaperEngineState: (payload: WallpaperEngineStateCommand): Promise<WallpaperEngineState> =>
    ipcRenderer.invoke(IPC.wallpaperEngineSetState, payload),
  getWallpaperEngineRuntimeStatus: (): Promise<WallpaperEngineRuntimeStatus> =>
    ipcRenderer.invoke(IPC.wallpaperEngineRuntimeStatus),
  prepareWallpaperEngineGlassSampler: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.wallpaperEngineGlassSamplerPrepare, { sessionId }),
  activateWallpaperEngineDwmSurface: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.wallpaperEngineDwmActivate, { sessionId }),
  onWallpaperEngineStateChanged: (callback: (payload: WallpaperEngineState) => void): (() => void) =>
    bind(IPC.wallpaperEngineStateChanged, callback),
  onWallpaperEngineRuntimeChanged: (
    callback: (payload: WallpaperEngineRuntimeStatus) => void,
  ): (() => void) => bind(IPC.wallpaperEngineRuntimeChanged, callback),
}

export type FluxDesktopApi = typeof api

contextBridge.exposeInMainWorld('fluxDesktop', api)

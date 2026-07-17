import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type DesktopWindowState,
  type HotkeyBinding,
  type HotkeyConfigureResult,
} from '@shared/ipc-contract'
import type { FluxMusicApi } from '@shared/music-contract'
import type { PerfState } from '@shared/perf-state'
import type {
  CustomBackground,
  CustomBackgroundResult,
  WallpaperEngineScanResult,
} from '@shared/custom-background-contract'
import type { UpdaterCommandResult, UpdaterState } from '@shared/updater-contract'

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
}

const api = {
  isDesktop: true as const,
  music,
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
  configureGlobalHotkeys: (bindings: HotkeyBinding[]): Promise<HotkeyConfigureResult> =>
    ipcRenderer.invoke(IPC.configureGlobalHotkeys, bindings),
  onGlobalHotkey: (callback: (payload: { action: string }) => void): (() => void) =>
    bind(IPC.globalHotkey, callback),
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
  scanWallpaperEngineProjects: (): Promise<WallpaperEngineScanResult> =>
    ipcRenderer.invoke(IPC.customBackgroundScanWallpaperEngine),
  importWallpaperEngineProject: (projectId: string): Promise<CustomBackgroundResult> =>
    ipcRenderer.invoke(IPC.customBackgroundImportWallpaperEngine, { projectId }),
  chooseWallpaperEngineProject: (): Promise<CustomBackgroundResult> =>
    ipcRenderer.invoke(IPC.customBackgroundChooseWallpaperEngine),
  onCustomBackgroundChanged: (callback: (payload: CustomBackground | null) => void): (() => void) =>
    bind(IPC.customBackgroundChanged, callback),
}

export type FluxDesktopApi = typeof api

contextBridge.exposeInMainWorld('fluxDesktop', api)

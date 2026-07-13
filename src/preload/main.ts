import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc-contract'

function readApiBase(): string {
  const arg = process.argv.find((item) => item.startsWith('--flux-api-base='))
  return arg ? arg.slice('--flux-api-base='.length) : ''
}

function bind(channel: string, callback: (payload: any) => void): () => void {
  if (typeof callback !== 'function') return () => {}
  const listener = (_event: unknown, payload: any) => callback(payload ?? {})
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  isDesktop: true,
  apiBase: readApiBase(),
  // 窗口
  minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
  toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
  toggleFullscreen: () => ipcRenderer.invoke(IPC.windowToggleFullscreen),
  exitFullscreenWindowed: () => ipcRenderer.invoke(IPC.windowExitFullscreenWindowed),
  getWindowState: () => ipcRenderer.invoke(IPC.windowGetState),
  close: () => ipcRenderer.invoke(IPC.windowClose),
  onWindowState: (callback: (state: any) => void) => bind(IPC.windowStateChanged, callback),
  // 性能状态机
  onPerfState: (callback: (state: any) => void) => bind(IPC.perfStateChanged, callback),
  // 登录
  openNeteaseLogin: () => ipcRenderer.invoke(IPC.neteaseOpenLogin),
  clearNeteaseLogin: () => ipcRenderer.invoke(IPC.neteaseClearLogin),
  openQQLogin: () => ipcRenderer.invoke(IPC.qqOpenLogin),
  clearQQLogin: () => ipcRenderer.invoke(IPC.qqClearLogin),
  // 应用
  restartApp: () => ipcRenderer.invoke(IPC.restartApp),
  configureGlobalHotkeys: (bindings: any[]) => ipcRenderer.invoke(IPC.configureGlobalHotkeys, bindings || []),
  onGlobalHotkey: (callback: (payload: any) => void) => bind(IPC.globalHotkey, callback),
  exportJsonFile: (payload: any) => ipcRenderer.invoke(IPC.exportJsonFile, payload || {}),
  importJsonFile: () => ipcRenderer.invoke(IPC.importJsonFile),
  // M6 updater: no automatic check/download; every transition is an explicit renderer command.
  getUpdaterState: () => ipcRenderer.invoke(IPC.updaterGetState),
  checkForUpdates: () => ipcRenderer.invoke(IPC.updaterCheck),
  downloadUpdate: () => ipcRenderer.invoke(IPC.updaterDownload),
  installUpdate: () => ipcRenderer.invoke(IPC.updaterInstall),
  onUpdaterState: (callback: (payload: any) => void) => bind(IPC.updaterStateChanged, callback),
  // 自定义背景：路径只在主进程内解析，renderer 仅接收受控协议 URL。
  getCustomBackground: () => ipcRenderer.invoke(IPC.customBackgroundGet),
  chooseCustomBackgroundFile: () => ipcRenderer.invoke(IPC.customBackgroundChooseFile),
  clearCustomBackground: () => ipcRenderer.invoke(IPC.customBackgroundClear),
  scanWallpaperEngineProjects: () => ipcRenderer.invoke(IPC.customBackgroundScanWallpaperEngine),
  importWallpaperEngineProject: (projectId: string) =>
    ipcRenderer.invoke(IPC.customBackgroundImportWallpaperEngine, { projectId }),
  chooseWallpaperEngineProject: () => ipcRenderer.invoke(IPC.customBackgroundChooseWallpaperEngine),
  onCustomBackgroundChanged: (callback: (payload: any) => void) =>
    bind(IPC.customBackgroundChanged, callback),
}

export type FluxDesktopApi = typeof api

contextBridge.exposeInMainWorld('fluxDesktop', api)

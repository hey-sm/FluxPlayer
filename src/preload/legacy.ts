import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc-contract'

/**
 * legacy 兼容桥：为旧 public/index.html 复刻旧版 desktopWindow API 表面。
 * 已删除的子系统（壁纸/手写更新/桌面歌词旧实现）由主进程返回 ok:false 的兼容应答。
 */

function bind(channel: string, callback: (payload: any) => void): () => void {
  if (typeof callback !== 'function') return () => {}
  const listener = (_event: unknown, payload: any) => callback(payload ?? {})
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('desktopWindow', {
  isDesktop: true,
  minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
  toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
  toggleFullscreen: () => ipcRenderer.invoke(IPC.windowToggleFullscreen),
  exitFullscreenWindowed: () => ipcRenderer.invoke(IPC.windowExitFullscreenWindowed),
  getState: () => ipcRenderer.invoke(IPC.windowGetState),
  close: () => ipcRenderer.invoke(IPC.windowClose),
  openNeteaseMusicLogin: () => ipcRenderer.invoke(IPC.neteaseOpenLogin),
  clearNeteaseMusicLogin: () => ipcRenderer.invoke(IPC.neteaseClearLogin),
  openQQMusicLogin: () => ipcRenderer.invoke(IPC.qqOpenLogin),
  clearQQMusicLogin: () => ipcRenderer.invoke(IPC.qqClearLogin),
  openUpdateInstaller: (filePath: string) => ipcRenderer.invoke(IPC.openUpdateInstaller, filePath),
  restartApp: () => ipcRenderer.invoke(IPC.restartApp),
  configureGlobalHotkeys: (bindings: any[]) => ipcRenderer.invoke(IPC.configureGlobalHotkeys, bindings || []),
  exportJsonFile: (payload: any) => ipcRenderer.invoke(IPC.exportJsonFile, payload || {}),
  importJsonFile: () => ipcRenderer.invoke(IPC.importJsonFile),
  onGlobalHotkey: (callback: (payload: any) => void) => bind(IPC.globalHotkey, callback),
  setDesktopLyricsEnabled: (enabled: boolean, payload: any) =>
    ipcRenderer.invoke(IPC.desktopLyricsSetEnabled, !!enabled, payload || {}),
  updateDesktopLyrics: (payload: any) => ipcRenderer.invoke(IPC.desktopLyricsUpdate, payload || {}),
  onDesktopLyricsLockState: (callback: (payload: any) => void) => bind(IPC.desktopLyricsLockState, callback),
  onDesktopLyricsEnabledState: (callback: (payload: any) => void) => bind(IPC.desktopLyricsEnabledState, callback),
  onStateChange: (callback: (state: any) => void) => bind(IPC.windowStateChanged, callback),
})

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('desktop-shell-root')
  document.body.classList.add('desktop-shell')
})

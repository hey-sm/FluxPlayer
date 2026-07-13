/**
 * IPC 契约 —— 全部通道名的单一事实源。
 *
 * 通道名保持与旧版（Mineradio v1.1.1 desktop/preload.js）一致：
 * 这是 strangler 迁移的兼容边界，legacy 前端与新 React 前端共用同一套通道。
 * 已删除或尚未迁移的子系统仅保留仍在使用的兼容通道。
 */
export const IPC = {
  // 窗口控制
  windowMinimize: 'desktop-window-minimize',
  windowToggleMaximize: 'desktop-window-toggle-maximize',
  windowToggleFullscreen: 'desktop-window-toggle-fullscreen',
  windowExitFullscreenWindowed: 'desktop-window-exit-fullscreen-windowed',
  windowGetState: 'desktop-window-get-state',
  windowClose: 'desktop-window-close',
  windowStateChanged: 'desktop-window-state', // main -> renderer
  // 性能状态机（新增）
  perfStateChanged: 'flux-perf-state', // main -> renderer
  // 登录
  neteaseOpenLogin: 'netease-music-open-login',
  neteaseClearLogin: 'netease-music-clear-login',
  qqOpenLogin: 'qq-music-open-login',
  qqClearLogin: 'qq-music-clear-login',
  // 应用
  restartApp: 'mineradio-restart-app',
  configureGlobalHotkeys: 'mineradio-hotkeys-configure-global',
  globalHotkey: 'mineradio-global-hotkey', // main -> renderer
  exportJsonFile: 'mineradio-export-json-file',
  importJsonFile: 'mineradio-import-json-file',
  // M6 更新状态机
  updaterGetState: 'flux-updater-get-state',
  updaterCheck: 'flux-updater-check',
  updaterDownload: 'flux-updater-download',
  updaterInstall: 'flux-updater-install',
  updaterStateChanged: 'flux-updater-state-changed', // main -> renderer
  // 受控自定义背景
  customBackgroundGet: 'flux-custom-background-get',
  customBackgroundChooseFile: 'flux-custom-background-choose-file',
  customBackgroundClear: 'flux-custom-background-clear',
  customBackgroundScanWallpaperEngine: 'flux-custom-background-scan-wallpaper-engine',
  customBackgroundImportWallpaperEngine: 'flux-custom-background-import-wallpaper-engine',
  customBackgroundChooseWallpaperEngine: 'flux-custom-background-choose-wallpaper-engine',
  customBackgroundChanged: 'flux-custom-background-changed', // main -> renderer
  // 兼容通道
  openUpdateInstaller: 'mineradio-open-update-installer',
  desktopLyricsSetEnabled: 'mineradio-desktop-lyrics-set-enabled',
  desktopLyricsUpdate: 'mineradio-desktop-lyrics-update',
  desktopLyricsLockState: 'mineradio-desktop-lyrics-lock-state', // main -> renderer
  desktopLyricsEnabledState: 'mineradio-desktop-lyrics-enabled-state', // main -> renderer
} as const

export interface DisplayState {
  displayId: number | undefined
  primaryDisplayId: number | undefined
  isPrimaryDisplay: boolean
  hasDisplayOnLeft: boolean
  hasDisplayOnRight: boolean
  displayBounds: { x: number; y: number; width: number; height: number } | null
}

export interface DesktopWindowState extends DisplayState {
  isMaximized: boolean
  isNativeFullScreen: boolean
  isHtmlFullScreen: boolean
  isWindowFullScreen: boolean
  isFullScreen: boolean
  isMinimized: boolean
  isVisible: boolean
  isFocused: boolean
}

export interface HotkeyBinding {
  action: string
  accelerator: string
}

export interface HotkeyConfigureResult {
  ok: boolean
  results: Array<{
    action: string
    accelerator: string
    ok: boolean
    conflict?: { sourceName: string; sourceIcon: string; reason: string }
  }>
}

export interface LoginWindowResult {
  ok: boolean
  cookie?: string
  reused?: boolean
  partial?: boolean
  cancelled?: boolean
  message?: string
  error?: string
}

export interface IpcResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

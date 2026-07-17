/** IPC channels shared by the trusted renderer, preload, and main process. */
export const IPC = {
  windowMinimize: 'flux:window:minimize',
  windowToggleMaximize: 'flux:window:toggle-maximize',
  windowToggleFullscreen: 'flux:window:toggle-fullscreen',
  windowExitFullscreenWindowed: 'flux:window:exit-fullscreen-windowed',
  windowGetState: 'flux:window:get-state',
  windowClose: 'flux:window:close',
  windowStateChanged: 'flux:window:state-changed',
  perfStateChanged: 'flux:performance:state-changed',
  musicSearch: 'flux:music:search',
  musicResolvePlayback: 'flux:music:resolve-playback',
  musicGetLyrics: 'flux:music:get-lyrics',
  musicGetAuthStatus: 'flux:music:get-auth-status',
  musicLogin: 'flux:music:login',
  musicLogout: 'flux:music:logout',
  musicGetPlaylists: 'flux:music:get-playlists',
  musicGetPlaylistTracks: 'flux:music:get-playlist-tracks',
  musicGetLikedTracks: 'flux:music:get-liked-tracks',
  restartApp: 'flux:app:restart',
  configureGlobalHotkeys: 'flux:hotkeys:configure-global',
  globalHotkey: 'flux:hotkeys:triggered',
  updaterGetState: 'flux:updater:get-state',
  updaterCheck: 'flux:updater:check',
  updaterDownload: 'flux:updater:download',
  updaterInstall: 'flux:updater:install',
  updaterStateChanged: 'flux:updater:state-changed',
  customBackgroundGet: 'flux:background:get',
  customBackgroundChooseFile: 'flux:background:choose-file',
  customBackgroundClear: 'flux:background:clear',
  customBackgroundScanWallpaperEngine: 'flux:background:scan-wallpaper-engine',
  customBackgroundImportWallpaperEngine: 'flux:background:import-wallpaper-engine',
  customBackgroundChooseWallpaperEngine: 'flux:background:choose-wallpaper-engine',
  customBackgroundChanged: 'flux:background:changed',
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

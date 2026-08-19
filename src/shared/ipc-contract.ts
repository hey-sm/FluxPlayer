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
  musicGetDiscover: 'flux:music:get-discover',
  restartApp: 'flux:app:restart',
  updaterGetState: 'flux:updater:get-state',
  updaterCheck: 'flux:updater:check',
  updaterDownload: 'flux:updater:download',
  updaterInstall: 'flux:updater:install',
  updaterStateChanged: 'flux:updater:state-changed',
  customBackgroundGet: 'flux:background:get',
  customBackgroundChooseFile: 'flux:background:choose-file',
  customBackgroundClear: 'flux:background:clear',
  customBackgroundChanged: 'flux:background:changed',
  wallpaperEngineList: 'flux:wallpaper-engine:list',
  wallpaperEngineChooseDirectory: 'flux:wallpaper-engine:choose-directory',
  wallpaperEngineChooseProjectFile: 'flux:wallpaper-engine:choose-project-file',
  wallpaperEngineRemoveDirectory: 'flux:wallpaper-engine:remove-directory',
  wallpaperEngineProjectDetails: 'flux:wallpaper-engine:project-details',
  wallpaperEngineGetState: 'flux:wallpaper-engine:get-state',
  wallpaperEngineSetState: 'flux:wallpaper-engine:set-state',
  wallpaperEngineRuntimeStatus: 'flux:wallpaper-engine:runtime-status',
  wallpaperEngineGlassSamplerPrepare: 'flux:wallpaper-engine:glass-sampler-prepare',
  wallpaperEngineDwmActivate: 'flux:wallpaper-engine:dwm-activate',
  wallpaperEngineStateChanged: 'flux:wallpaper-engine:state-changed',
  wallpaperEngineRuntimeChanged: 'flux:wallpaper-engine:runtime-changed',
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

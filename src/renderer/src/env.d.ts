/// <reference types="vite/client" />

interface FluxDesktopApi {
  isDesktop: boolean
  music: import('@shared/music-contract').FluxMusicApi
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  toggleFullscreen(): Promise<void>
  exitFullscreenWindowed(): Promise<void>
  getWindowState(): Promise<import('@shared/ipc-contract').DesktopWindowState>
  close(): Promise<void>
  onWindowState(callback: (state: import('@shared/ipc-contract').DesktopWindowState) => void): () => void
  onPerfState(callback: (state: import('@shared/perf-state').PerfState) => void): () => void
  restartApp(): Promise<{ ok: boolean }>
  getUpdaterState(): Promise<import('@shared/updater-contract').UpdaterState>
  checkForUpdates(): Promise<import('@shared/updater-contract').UpdaterCommandResult>
  downloadUpdate(): Promise<import('@shared/updater-contract').UpdaterCommandResult>
  installUpdate(): Promise<import('@shared/updater-contract').UpdaterCommandResult>
  onUpdaterState(callback: (payload: import('@shared/updater-contract').UpdaterState) => void): () => void
  getCustomBackground(): Promise<import('@shared/custom-background-contract').CustomBackground | null>
  chooseCustomBackgroundFile(): Promise<import('@shared/custom-background-contract').CustomBackgroundResult>
  clearCustomBackground(): Promise<import('@shared/custom-background-contract').CustomBackgroundResult>
  onCustomBackgroundChanged(
    callback: (payload: import('@shared/custom-background-contract').CustomBackground | null) => void,
  ): () => void
  listWallpaperEngineProjects(force?: boolean): Promise<
    import('@shared/wallpaper-engine-contract').WallpaperEngineLibrarySnapshot & {
      state: import('@shared/wallpaper-engine-contract').WallpaperEngineState
    }
  >
  chooseWallpaperEngineDirectory(): Promise<
    import('@shared/wallpaper-engine-contract').WallpaperEngineCommandResult
  >
  chooseWallpaperEngineProjectFile(): Promise<
    import('@shared/wallpaper-engine-contract').WallpaperEngineCommandResult
  >
  removeWallpaperEngineDirectory(
    id: string,
  ): Promise<import('@shared/wallpaper-engine-contract').WallpaperEngineCommandResult>
  getWallpaperEngineProjectDetails(
    id: string,
  ): Promise<import('@shared/wallpaper-engine-contract').WallpaperEngineProjectDetails>
  getWallpaperEngineState(): Promise<import('@shared/wallpaper-engine-contract').WallpaperEngineState>
  setWallpaperEngineState(
    payload: import('@shared/wallpaper-engine-contract').WallpaperEngineStateCommand,
  ): Promise<import('@shared/wallpaper-engine-contract').WallpaperEngineState>
  getWallpaperEngineRuntimeStatus(): Promise<
    import('@shared/wallpaper-engine-contract').WallpaperEngineRuntimeStatus
  >
  prepareWallpaperEngineGlassSampler(sessionId: string): Promise<boolean>
  activateWallpaperEngineDwmSurface(sessionId: string): Promise<boolean>
  onWallpaperEngineStateChanged(
    callback: (payload: import('@shared/wallpaper-engine-contract').WallpaperEngineState) => void,
  ): () => void
  onWallpaperEngineRuntimeChanged(
    callback: (payload: import('@shared/wallpaper-engine-contract').WallpaperEngineRuntimeStatus) => void,
  ): () => void
}

interface Window {
  fluxDesktop?: FluxDesktopApi
}

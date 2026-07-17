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
  configureGlobalHotkeys(bindings: unknown[]): Promise<unknown>
  onGlobalHotkey(callback: (payload: { action: string }) => void): () => void
  getUpdaterState(): Promise<import('@shared/updater-contract').UpdaterState>
  checkForUpdates(): Promise<import('@shared/updater-contract').UpdaterCommandResult>
  downloadUpdate(): Promise<import('@shared/updater-contract').UpdaterCommandResult>
  installUpdate(): Promise<import('@shared/updater-contract').UpdaterCommandResult>
  onUpdaterState(callback: (payload: import('@shared/updater-contract').UpdaterState) => void): () => void
  getCustomBackground(): Promise<import('@shared/custom-background-contract').CustomBackground | null>
  chooseCustomBackgroundFile(): Promise<import('@shared/custom-background-contract').CustomBackgroundResult>
  clearCustomBackground(): Promise<import('@shared/custom-background-contract').CustomBackgroundResult>
  scanWallpaperEngineProjects(): Promise<
    import('@shared/custom-background-contract').WallpaperEngineScanResult
  >
  importWallpaperEngineProject(
    projectId: string,
  ): Promise<import('@shared/custom-background-contract').CustomBackgroundResult>
  chooseWallpaperEngineProject(): Promise<import('@shared/custom-background-contract').CustomBackgroundResult>
  onCustomBackgroundChanged(
    callback: (payload: import('@shared/custom-background-contract').CustomBackground | null) => void,
  ): () => void
}

interface Window {
  fluxDesktop?: FluxDesktopApi
}

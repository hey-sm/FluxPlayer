/// <reference types="vite/client" />

interface FluxDesktopApi {
  isDesktop: boolean
  apiBase: string
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  toggleFullscreen(): Promise<void>
  exitFullscreenWindowed(): Promise<void>
  getWindowState(): Promise<import('@shared/ipc-contract').DesktopWindowState>
  close(): Promise<void>
  onWindowState(callback: (state: import('@shared/ipc-contract').DesktopWindowState) => void): () => void
  onPerfState(callback: (state: import('@shared/perf-state').PerfState) => void): () => void
  openNeteaseLogin(): Promise<import('@shared/ipc-contract').LoginWindowResult>
  clearNeteaseLogin(): Promise<{ ok: boolean }>
  openQQLogin(): Promise<import('@shared/ipc-contract').LoginWindowResult>
  clearQQLogin(): Promise<{ ok: boolean }>
  restartApp(): Promise<{ ok: boolean }>
  configureGlobalHotkeys(bindings: unknown[]): Promise<unknown>
  onGlobalHotkey(callback: (payload: { action: string }) => void): () => void
  exportJsonFile(payload: unknown): Promise<{ ok: boolean }>
  importJsonFile(): Promise<{ ok: boolean; text?: string }>
  getUpdaterState(): Promise<import('@shared/updater-contract').UpdaterState>
  checkForUpdates(): Promise<import('@shared/updater-contract').UpdaterCommandResult>
  downloadUpdate(): Promise<import('@shared/updater-contract').UpdaterCommandResult>
  installUpdate(): Promise<import('@shared/updater-contract').UpdaterCommandResult>
  onUpdaterState(callback: (payload: import('@shared/updater-contract').UpdaterState) => void): () => void
  getCustomBackground(): Promise<import('@shared/custom-background-contract').CustomBackgroundResult>
  chooseCustomBackgroundFile(): Promise<import('@shared/custom-background-contract').CustomBackgroundResult>
  clearCustomBackground(): Promise<import('@shared/custom-background-contract').CustomBackgroundResult>
  scanWallpaperEngineProjects(): Promise<import('@shared/custom-background-contract').WallpaperEngineScanResult>
  importWallpaperEngineProject(projectId: string): Promise<import('@shared/custom-background-contract').CustomBackgroundResult>
  chooseWallpaperEngineProject(): Promise<import('@shared/custom-background-contract').CustomBackgroundResult>
  onCustomBackgroundChanged(callback: (payload: import('@shared/custom-background-contract').CustomBackgroundResult) => void): () => void
}

interface Window {
  fluxDesktop?: FluxDesktopApi
}

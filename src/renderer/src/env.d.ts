/// <reference types="vite/client" />

interface ChkszApi {
  /** 查询 ChKSz 密钥是否已配置、是否已启用（不返回明文密钥）。 */
  getStatus(): Promise<{ configured: boolean; enabled: boolean }>
  /** 保存 ChKSz API Key（DPAPI 加密落盘）并自动启用。 */
  setKey(key: string): Promise<{ ok: boolean }>
  /** 清除已保存的 ChKSz API Key。 */
  clearKey(): Promise<{ ok: boolean }>
  /** 切换 ChKSz 启用状态（停用不清除密钥）。 */
  setEnabled(enabled: boolean): Promise<{ ok: boolean }>
  /** 主进程配额/限流告警 → renderer 顶栏 toast。 */
  onQuotaWarning(callback: (payload: { title: string; message: string }) => void): () => void
}

interface FluxDesktopApi {
  isDesktop: boolean
  music: import('@shared/music-contract').FluxMusicApi
  chksz: ChkszApi
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

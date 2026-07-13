export interface UpdaterUpdateInfo {
  version: string
}

export interface UpdaterCheckResult {
  isUpdateAvailable: boolean
  updateInfo: UpdaterUpdateInfo
}

export interface UpdaterDownloadProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdaterEventMap {
  'checking-for-update': []
  'update-available': [info: UpdaterUpdateInfo]
  'update-not-available': [info: UpdaterUpdateInfo]
  'download-progress': [progress: UpdaterDownloadProgress]
  'update-downloaded': [info: UpdaterUpdateInfo]
  error: [error: unknown, message?: string]
}

export type UpdaterEventName = keyof UpdaterEventMap
export type UpdaterEventListener<Event extends UpdaterEventName> = (...args: UpdaterEventMap[Event]) => void

/** Electron-free boundary consumed by UpdaterController and unit-test fakes. */
export interface UpdaterAdapter {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  readonly currentVersion: string

  checkForUpdates(): Promise<UpdaterCheckResult | null>
  downloadUpdate(): Promise<readonly string[]>
  quitAndInstall(): void

  on<Event extends UpdaterEventName>(event: Event, listener: UpdaterEventListener<Event>): void
  removeListener<Event extends UpdaterEventName>(event: Event, listener: UpdaterEventListener<Event>): void
}

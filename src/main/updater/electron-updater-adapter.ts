import { UPDATER_PROVIDER } from '@shared/updater-contract'
import type { UpdaterAdapter, UpdaterCheckResult, UpdaterEventListener, UpdaterEventName } from './adapter'

export interface ElectronUpdaterPort {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  readonly currentVersion: { readonly version: string }
  setFeedURL(options: { provider: 'github'; owner: string; repo: string }): void
  checkForUpdates(): Promise<UpdaterCheckResult | null>
  downloadUpdate(): Promise<readonly string[]>
  quitAndInstall(): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown
}

/**
 * Thin production adapter. Importing this module is safe in Node tests: Electron/electron-updater
 * is loaded only when createElectronUpdaterAdapter() is called after Electron app readiness.
 */
export class ElectronUpdaterAdapter implements UpdaterAdapter {
  constructor(private readonly updater: ElectronUpdaterPort) {
    updater.autoDownload = false
    // Explicit install must own cleanup; a normal app quit must never bypass prepareForInstall.
    updater.autoInstallOnAppQuit = false
    updater.setFeedURL({
      provider: 'github',
      owner: UPDATER_PROVIDER.owner,
      repo: UPDATER_PROVIDER.repo,
    })
  }

  get autoDownload(): boolean {
    return this.updater.autoDownload
  }

  set autoDownload(value: boolean) {
    this.updater.autoDownload = value
  }

  get autoInstallOnAppQuit(): boolean {
    return this.updater.autoInstallOnAppQuit
  }

  set autoInstallOnAppQuit(value: boolean) {
    this.updater.autoInstallOnAppQuit = value
  }

  get currentVersion(): string {
    return this.updater.currentVersion.version
  }

  checkForUpdates(): Promise<UpdaterCheckResult | null> {
    return this.updater.checkForUpdates()
  }

  downloadUpdate(): Promise<readonly string[]> {
    return this.updater.downloadUpdate()
  }

  quitAndInstall(): void {
    this.updater.quitAndInstall()
  }

  on<Event extends UpdaterEventName>(event: Event, listener: UpdaterEventListener<Event>): void {
    this.updater.on(event, listener as unknown as (...args: unknown[]) => void)
  }

  removeListener<Event extends UpdaterEventName>(event: Event, listener: UpdaterEventListener<Event>): void {
    this.updater.removeListener(event, listener as unknown as (...args: unknown[]) => void)
  }
}

export async function createElectronUpdaterAdapter(): Promise<ElectronUpdaterAdapter> {
  const { autoUpdater } = await import('electron-updater')
  return new ElectronUpdaterAdapter(autoUpdater as unknown as ElectronUpdaterPort)
}

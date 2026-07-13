import { EventEmitter } from 'node:events'
import type {
  UpdaterAdapter,
  UpdaterCheckResult,
  UpdaterEventListener,
  UpdaterEventMap,
  UpdaterEventName,
} from './adapter'

type MaybePromise<Value> = Value | Promise<Value>

export interface FakeUpdaterAdapterOptions {
  currentVersion?: string
  checkForUpdates?: (adapter: FakeUpdaterAdapter) => MaybePromise<UpdaterCheckResult | null>
  downloadUpdate?: (adapter: FakeUpdaterAdapter) => MaybePromise<readonly string[]>
  quitAndInstall?: (adapter: FakeUpdaterAdapter) => void
}

/** Deterministic Electron-free adapter for controller and integration tests. */
export class FakeUpdaterAdapter implements UpdaterAdapter {
  autoDownload = true
  autoInstallOnAppQuit = true
  readonly currentVersion: string
  checkCalls = 0
  downloadCalls = 0
  installCalls = 0

  private readonly emitter = new EventEmitter()

  constructor(private readonly options: FakeUpdaterAdapterOptions = {}) {
    this.currentVersion = options.currentVersion ?? '0.0.0-test'
  }

  async checkForUpdates(): Promise<UpdaterCheckResult | null> {
    this.checkCalls += 1
    if (this.options.checkForUpdates) return this.options.checkForUpdates(this)
    return {
      isUpdateAvailable: false,
      updateInfo: { version: this.currentVersion },
    }
  }

  async downloadUpdate(): Promise<readonly string[]> {
    this.downloadCalls += 1
    if (this.options.downloadUpdate) return this.options.downloadUpdate(this)
    return []
  }

  quitAndInstall(): void {
    this.installCalls += 1
    this.options.quitAndInstall?.(this)
  }

  on<Event extends UpdaterEventName>(event: Event, listener: UpdaterEventListener<Event>): void {
    this.emitter.on(event, listener)
  }

  removeListener<Event extends UpdaterEventName>(event: Event, listener: UpdaterEventListener<Event>): void {
    this.emitter.removeListener(event, listener)
  }

  emit<Event extends UpdaterEventName>(event: Event, ...args: UpdaterEventMap[Event]): boolean {
    return this.emitter.emit(event, ...args)
  }

  listenerCount(event: UpdaterEventName): number {
    return this.emitter.listenerCount(event)
  }
}

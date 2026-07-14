import type {
  UpdaterCommandResult,
  UpdaterError,
  UpdaterProgress,
  UpdaterState,
} from '@shared/updater-contract'
import type {
  UpdaterAdapter,
  UpdaterCheckResult,
  UpdaterDownloadProgress,
  UpdaterUpdateInfo,
} from './adapter'

export type UpdaterDisabledReason = NonNullable<UpdaterState['disabledReason']>
export type UpdaterCommand = 'check' | 'download' | 'install'
export type UpdaterStateListener = (state: UpdaterState) => void

export interface UpdaterRuntimeMode {
  isDevelopment?: boolean
  isSmoke?: boolean
}

export interface UpdaterControllerOptions extends UpdaterRuntimeMode {
  adapter: UpdaterAdapter
  currentVersion?: string
  mode?: UpdaterRuntimeMode
  disabledReason?: UpdaterDisabledReason | null
  prepareForInstall: () => void | Promise<void>
  onStateChange?: UpdaterStateListener
}

const DISABLED_MESSAGES: Record<UpdaterDisabledReason, string> = {
  development: 'Updater is disabled in development mode.',
  smoke: 'Updater is disabled during smoke tests.',
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizeVersion(info: UpdaterUpdateInfo | undefined): string | null {
  const version = typeof info?.version === 'string' ? info.version.trim() : ''
  return version || null
}

function cloneError(error: UpdaterError | null): UpdaterError | null {
  return error ? { ...error } : null
}

function cloneProgress(progress: UpdaterProgress | null): UpdaterProgress | null {
  return progress ? { ...progress } : null
}

function cloneState(state: Readonly<UpdaterState>): UpdaterState {
  return {
    ...state,
    progress: cloneProgress(state.progress),
    error: cloneError(state.error),
  }
}

function sameState(left: Readonly<UpdaterState>, right: Readonly<UpdaterState>): boolean {
  return (
    left.status === right.status &&
    left.currentVersion === right.currentVersion &&
    left.availableVersion === right.availableVersion &&
    left.disabledReason === right.disabledReason &&
    left.progress?.percent === right.progress?.percent &&
    left.progress?.bytesPerSecond === right.progress?.bytesPerSecond &&
    left.progress?.transferred === right.progress?.transferred &&
    left.progress?.total === right.progress?.total &&
    left.error?.code === right.error?.code &&
    left.error?.message === right.error?.message
  )
}

function objectString(value: unknown, key: 'code' | 'message'): string | null {
  if (!value || typeof value !== 'object' || !(key in value)) return null
  const candidate = (value as Record<string, unknown>)[key]
  if (typeof candidate !== 'string') return null
  const normalized = candidate.trim()
  return normalized || null
}

export function normalizeUpdaterError(
  error: unknown,
  fallbackCode = 'UPDATER_ERROR',
  fallbackMessage = 'The updater operation failed.',
): UpdaterError {
  const code = objectString(error, 'code') ?? fallbackCode
  const message =
    objectString(error, 'message') ??
    (typeof error === 'string' && error.trim() ? error.trim() : fallbackMessage)
  return { code, message }
}

export function resolveUpdaterDisabledReason(mode: UpdaterRuntimeMode = {}): UpdaterDisabledReason | null {
  if (mode.isDevelopment) return 'development'
  if (mode.isSmoke) return 'smoke'
  return null
}

function normalizeProgress(progress: UpdaterDownloadProgress): UpdaterProgress {
  return {
    percent: Math.min(100, Math.max(0, finiteOrZero(progress.percent))),
    bytesPerSecond: Math.max(0, finiteOrZero(progress.bytesPerSecond)),
    transferred: Math.max(0, finiteOrZero(progress.transferred)),
    total: Math.max(0, finiteOrZero(progress.total)),
  }
}

/** Explicit, event-driven updater state machine. It never checks or downloads on construction. */
export class UpdaterController {
  private state: UpdaterState
  private readonly adapter: UpdaterAdapter
  private readonly prepareForInstall: () => void | Promise<void>
  private readonly listeners = new Set<UpdaterStateListener>()
  private activeCommand: UpdaterCommand | null = null
  private disposed = false
  private installRequested = false
  private hasDownloadedUpdate = false

  constructor(options: UpdaterControllerOptions) {
    this.adapter = options.adapter
    this.prepareForInstall = options.prepareForInstall
    this.adapter.autoDownload = false
    this.adapter.autoInstallOnAppQuit = false

    const mode = {
      isDevelopment: options.isDevelopment ?? options.mode?.isDevelopment,
      isSmoke: options.isSmoke ?? options.mode?.isSmoke,
    }
    const disabledReason =
      options.disabledReason === undefined ? resolveUpdaterDisabledReason(mode) : options.disabledReason

    this.state = {
      status: 'idle',
      currentVersion: options.currentVersion ?? this.adapter.currentVersion,
      availableVersion: null,
      progress: null,
      error: null,
      disabledReason,
    }

    if (options.onStateChange) this.listeners.add(options.onStateChange)
    if (!disabledReason) this.attachAdapterListeners()
  }

  getState(): UpdaterState {
    return cloneState(this.state)
  }

  subscribe(listener: UpdaterStateListener): () => void {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async check(): Promise<UpdaterCommandResult> {
    const rejected = this.validateCommand('check', ['idle', 'not-available', 'error'])
    if (rejected) return rejected

    this.activeCommand = 'check'
    this.hasDownloadedUpdate = false
    this.transition({
      status: 'checking',
      availableVersion: null,
      progress: null,
      error: null,
    })

    try {
      const result = await this.adapter.checkForUpdates()
      if (this.disposed) return this.disposedResult()

      if (this.state.status === 'checking') this.applyCheckResult(result)
      if (this.state.status === 'error') return this.currentErrorResult()
      if (this.state.status !== 'available' && this.state.status !== 'not-available') {
        const error = this.setRuntimeError(
          { message: `Unexpected updater state after check: ${this.state.status}` },
          'UPDATER_CHECK_FAILED',
          'Update check did not produce a final state.',
        )
        return this.failure(error)
      }
      return this.success()
    } catch (error) {
      if (this.disposed) return this.disposedResult()
      const normalized =
        this.state.status === 'error' && this.state.error
          ? this.state.error
          : this.setRuntimeError(error, 'UPDATER_CHECK_FAILED', 'Failed to check for updates.')
      return this.failure(normalized)
    } finally {
      this.activeCommand = null
    }
  }

  async download(): Promise<UpdaterCommandResult> {
    const rejected = this.validateCommand('download', ['available'])
    if (rejected) return rejected

    this.activeCommand = 'download'
    this.hasDownloadedUpdate = false
    this.transition({ status: 'downloading', progress: null, error: null })

    try {
      await this.adapter.downloadUpdate()
      if (this.disposed) return this.disposedResult()

      if (this.state.status === 'downloading' || this.state.status === 'progress') {
        this.hasDownloadedUpdate = true
        this.transition({ status: 'downloaded', progress: null, error: null })
      }
      if (this.state.status === 'error') return this.currentErrorResult()
      if (this.state.status !== 'downloaded') {
        const error = this.setRuntimeError(
          { message: `Unexpected updater state after download: ${this.state.status}` },
          'UPDATER_DOWNLOAD_FAILED',
          'Update download did not produce a final state.',
        )
        return this.failure(error)
      }
      return this.success()
    } catch (error) {
      if (this.disposed) return this.disposedResult()
      const normalized =
        this.state.status === 'error' && this.state.error
          ? this.state.error
          : this.setRuntimeError(error, 'UPDATER_DOWNLOAD_FAILED', 'Failed to download the update.')
      return this.failure(normalized)
    } finally {
      this.activeCommand = null
    }
  }

  async install(): Promise<UpdaterCommandResult> {
    const allowedStates: readonly UpdaterState['status'][] = this.hasDownloadedUpdate
      ? ['downloaded', 'error']
      : ['downloaded']
    const rejected = this.validateCommand('install', allowedStates)
    if (rejected) return rejected

    this.activeCommand = 'install'
    if (this.state.status === 'error') {
      this.transition({ status: 'downloaded', progress: null, error: null })
    }
    try {
      try {
        await this.prepareForInstall()
      } catch (error) {
        if (this.disposed) return this.disposedResult()
        const normalized = normalizeUpdaterError(
          error,
          'UPDATER_PREPARE_INSTALL_FAILED',
          'Failed to prepare the app for update installation.',
        )
        this.transition({ status: 'error', progress: null, error: normalized })
        return this.failure(normalized)
      }

      if (this.disposed) return this.disposedResult()
      if (this.state.status === 'error') return this.currentErrorResult()
      try {
        this.adapter.quitAndInstall()
      } catch (error) {
        const normalized = normalizeUpdaterError(
          error,
          'UPDATER_INSTALL_FAILED',
          'Failed to start update installation.',
        )
        this.transition({ status: 'error', progress: null, error: normalized })
        return this.failure(normalized)
      }
      // electron-updater reports some synchronous launch failures via its error event
      // instead of throwing from quitAndInstall(). Keep the downloaded update retryable.
      if (this.getState().status === 'error') return this.currentErrorResult()

      this.installRequested = true
      return this.success()
    } finally {
      this.activeCommand = null
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (!this.state.disabledReason) {
      this.adapter.removeListener('checking-for-update', this.handleCheckingForUpdate)
      this.adapter.removeListener('update-available', this.handleUpdateAvailable)
      this.adapter.removeListener('update-not-available', this.handleUpdateNotAvailable)
      this.adapter.removeListener('download-progress', this.handleDownloadProgress)
      this.adapter.removeListener('update-downloaded', this.handleUpdateDownloaded)
      this.adapter.removeListener('error', this.handleError)
    }
    this.listeners.clear()
  }

  private attachAdapterListeners(): void {
    this.adapter.on('checking-for-update', this.handleCheckingForUpdate)
    this.adapter.on('update-available', this.handleUpdateAvailable)
    this.adapter.on('update-not-available', this.handleUpdateNotAvailable)
    this.adapter.on('download-progress', this.handleDownloadProgress)
    this.adapter.on('update-downloaded', this.handleUpdateDownloaded)
    this.adapter.on('error', this.handleError)
  }

  private readonly handleCheckingForUpdate = (): void => {
    if (this.disposed || this.activeCommand !== 'check') return
    this.transition({
      status: 'checking',
      availableVersion: null,
      progress: null,
      error: null,
    })
  }

  private readonly handleUpdateAvailable = (info: UpdaterUpdateInfo): void => {
    if (this.disposed || this.activeCommand !== 'check') return
    this.hasDownloadedUpdate = false
    this.transition({
      status: 'available',
      availableVersion: normalizeVersion(info),
      progress: null,
      error: null,
    })
  }

  private readonly handleUpdateNotAvailable = (_info: UpdaterUpdateInfo): void => {
    if (this.disposed || this.activeCommand !== 'check') return
    this.hasDownloadedUpdate = false
    this.transition({
      status: 'not-available',
      availableVersion: null,
      progress: null,
      error: null,
    })
  }

  private readonly handleDownloadProgress = (progress: UpdaterDownloadProgress): void => {
    if (this.disposed || this.activeCommand !== 'download') return
    this.transition({ status: 'progress', progress: normalizeProgress(progress), error: null })
  }

  private readonly handleUpdateDownloaded = (info: UpdaterUpdateInfo): void => {
    if (this.disposed || this.activeCommand !== 'download') return
    this.hasDownloadedUpdate = true
    this.transition({
      status: 'downloaded',
      availableVersion: normalizeVersion(info) ?? this.state.availableVersion,
      progress: null,
      error: null,
    })
  }

  private readonly handleError = (error: unknown, message?: string): void => {
    if (this.disposed) return
    const fallbackCode =
      this.activeCommand === 'check'
        ? 'UPDATER_CHECK_FAILED'
        : this.activeCommand === 'download'
          ? 'UPDATER_DOWNLOAD_FAILED'
          : this.activeCommand === 'install'
            ? 'UPDATER_INSTALL_FAILED'
            : 'UPDATER_ERROR'
    this.setRuntimeError(error, fallbackCode, message || 'The updater operation failed.')
  }

  private applyCheckResult(result: UpdaterCheckResult | null): void {
    if (!result) {
      throw {
        code: 'UPDATER_CHECK_UNAVAILABLE',
        message: 'The update service did not return a check result.',
      }
    }
    if (result.isUpdateAvailable) {
      this.handleUpdateAvailable(result.updateInfo)
    } else {
      this.handleUpdateNotAvailable(result.updateInfo)
    }
  }

  private validateCommand(
    command: UpdaterCommand,
    allowedStatuses: readonly UpdaterState['status'][],
  ): UpdaterCommandResult | null {
    if (this.disposed) return this.disposedResult()
    if (this.state.disabledReason) {
      return this.failure({
        code: 'UPDATER_DISABLED',
        message: DISABLED_MESSAGES[this.state.disabledReason],
      })
    }
    if (this.activeCommand) {
      return this.failure({
        code: 'UPDATER_COMMAND_IN_PROGRESS',
        message: `Cannot ${command} while ${this.activeCommand} is in progress.`,
      })
    }
    if (this.installRequested) {
      return this.failure({
        code: 'UPDATER_INSTALL_ALREADY_REQUESTED',
        message: 'Update installation has already been requested.',
      })
    }
    if (!allowedStatuses.includes(this.state.status)) {
      return this.failure({
        code: 'UPDATER_INVALID_STATE',
        message: `Cannot ${command} while updater status is "${this.state.status}"; expected ${allowedStatuses.map((status) => `"${status}"`).join(' or ')}.`,
      })
    }
    return null
  }

  private transition(patch: Partial<UpdaterState>): void {
    if (this.disposed) return
    const next: UpdaterState = {
      ...this.state,
      ...patch,
      progress:
        patch.progress === undefined ? cloneProgress(this.state.progress) : cloneProgress(patch.progress),
      error: patch.error === undefined ? cloneError(this.state.error) : cloneError(patch.error),
    }
    if (sameState(this.state, next)) return
    this.state = next
    for (const listener of this.listeners) {
      try {
        listener(cloneState(next))
      } catch {
        // A renderer/state observer must not break updater command completion.
      }
    }
  }

  private setRuntimeError(error: unknown, fallbackCode: string, fallbackMessage: string): UpdaterError {
    const normalized = normalizeUpdaterError(error, fallbackCode, fallbackMessage)
    this.transition({ status: 'error', progress: null, error: normalized })
    return normalized
  }

  private success(): UpdaterCommandResult {
    return { ok: true, state: this.getState() }
  }

  private failure(error: UpdaterError): UpdaterCommandResult {
    return { ok: false, state: this.getState(), error: { ...error } }
  }

  private currentErrorResult(): UpdaterCommandResult {
    return this.failure(
      this.state.error ?? {
        code: 'UPDATER_ERROR',
        message: 'The updater operation failed.',
      },
    )
  }

  private disposedResult(): UpdaterCommandResult {
    return this.failure({
      code: 'UPDATER_DISPOSED',
      message: 'Updater controller has been disposed.',
    })
  }
}

/** M6 electron-updater renderer/main contract. */
export const UPDATER_PROVIDER = Object.freeze({
  provider: 'github',
  owner: 'hey-sm',
  repo: 'FluxPlayer',
})

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'progress'
  | 'downloaded'
  | 'error'

export interface UpdaterProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdaterError {
  code: string
  message: string
}

export interface UpdaterState {
  status: UpdaterStatus
  currentVersion: string
  availableVersion: string | null
  progress: UpdaterProgress | null
  error: UpdaterError | null
  disabledReason: 'development' | 'smoke' | 'legacy' | null
}

export interface UpdaterCommandResult {
  ok: boolean
  state: UpdaterState
  error?: UpdaterError
}

export const DEFAULT_UPDATER_STATE: Readonly<UpdaterState> = Object.freeze({
  status: 'idle',
  currentVersion: '',
  availableVersion: null,
  progress: null,
  error: null,
  disabledReason: null,
})

import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_WALLPAPER_ENGINE_SELECTION,
  DEFAULT_WALLPAPER_ENGINE_STATE,
  WALLPAPER_ENGINE_STATE_VERSION,
  type WallpaperEngineSelection,
  type WallpaperEngineState,
} from '@shared/wallpaper-engine-contract'

const STORE_FILE = 'wallpaper-engine-state.json'
const RESET_MARKER = 'wallpaper-engine-storage-reset-v1'

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)
}

function normalizeSelection(value: unknown): WallpaperEngineSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ...DEFAULT_WALLPAPER_ENGINE_SELECTION }
  const raw = value as Record<string, unknown>
  const id = validId(raw.id) ? raw.id.toLowerCase() : ''
  const legacyPreview = raw.kind === 'preview'
  const kind = raw.kind === 'engine' ? 'engine' : 'media'
  const projectType =
    raw.projectType === 'video' ||
    raw.projectType === 'image' ||
    raw.projectType === 'scene' ||
    raw.projectType === 'web' ||
    raw.projectType === 'application'
      ? raw.projectType
      : 'unknown'
  return {
    version: WALLPAPER_ENGINE_STATE_VERSION,
    active: raw.active === true && Boolean(id) && !legacyPreview,
    id,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 160) : '',
    kind,
    mediaType: raw.mediaType === 'video' ? 'video' : 'image',
    projectType,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Math.max(0, Number(raw.updatedAt)) : 0,
    runtimeError: legacyPreview
      ? 'WALLPAPER_ENGINE_PREVIEW_SELECTION_MIGRATED'
      : typeof raw.runtimeError === 'string'
        ? raw.runtimeError.slice(0, 240)
        : '',
  }
}

function normalizeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter(validId).map((id) => id.toLowerCase()))].slice(0, 2000)
    : []
}

function normalizeState(value: unknown): WallpaperEngineState {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    version: WALLPAPER_ENGINE_STATE_VERSION,
    selection: normalizeSelection(raw.selection),
    favorites: normalizeIds(raw.favorites),
    hidden: normalizeIds(raw.hidden),
  }
}

export function resetLegacyBackgroundStorage(userDataPath: string): string | null {
  const root = path.resolve(userDataPath)
  const marker = path.join(root, RESET_MARKER)
  if (fs.existsSync(marker)) return null
  fs.mkdirSync(root, { recursive: true })
  const legacyPaths = [path.join(root, 'backgrounds'), path.join(root, 'backgrounds', 'current.json')]
  let backupPath: string | null = null
  const legacyDirectory = legacyPaths[0]
  if (fs.existsSync(legacyDirectory)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    backupPath = path.join(root, `backgrounds.backup-${stamp}`)
    try {
      fs.renameSync(legacyDirectory, backupPath)
    } catch {
      backupPath = null
    }
  }
  fs.writeFileSync(
    marker,
    JSON.stringify({ version: 1, resetAt: new Date().toISOString(), backupPath }, null, 2),
    'utf8',
  )
  return backupPath
}

export class WallpaperEngineStore {
  private readonly filePath: string
  private state: WallpaperEngineState

  constructor(userDataPath: string) {
    this.filePath = path.join(path.resolve(userDataPath), STORE_FILE)
    this.state = this.read()
  }

  get(): WallpaperEngineState {
    return {
      version: this.state.version,
      selection: { ...this.state.selection },
      favorites: [...this.state.favorites],
      hidden: [...this.state.hidden],
    }
  }

  setSelection(selection: Partial<WallpaperEngineSelection>): WallpaperEngineState {
    this.state = normalizeState({ ...this.state, selection: { ...this.state.selection, ...selection } })
    this.write()
    return this.get()
  }

  setProjectVisibility(id: string, hidden: boolean): WallpaperEngineState {
    if (!validId(id)) return this.get()
    const next = new Set(this.state.hidden)
    if (hidden) next.add(id.toLowerCase())
    else next.delete(id.toLowerCase())
    this.state = normalizeState({ ...this.state, hidden: [...next] })
    this.write()
    return this.get()
  }

  setFavorite(id: string, favorite: boolean): WallpaperEngineState {
    if (!validId(id)) return this.get()
    const next = new Set(this.state.favorites)
    if (favorite) next.add(id.toLowerCase())
    else next.delete(id.toLowerCase())
    this.state = normalizeState({ ...this.state, favorites: [...next] })
    this.write()
    return this.get()
  }

  clearSelection(): WallpaperEngineState {
    this.state = normalizeState({ ...this.state, selection: DEFAULT_WALLPAPER_ENGINE_SELECTION })
    this.write()
    return this.get()
  }

  deactivateSelection(id: string, error: string): WallpaperEngineState {
    if (!validId(id) || this.state.selection.id !== id.toLowerCase()) return this.get()
    this.state = normalizeState({
      ...this.state,
      selection: {
        ...this.state.selection,
        active: false,
        runtimeError: String(error || 'WALLPAPER_ENGINE_RUNTIME_FAILED').slice(0, 240),
      },
    })
    this.write()
    return this.get()
  }

  clearHidden(): WallpaperEngineState {
    this.state = normalizeState({ ...this.state, hidden: [] })
    this.write()
    return this.get()
  }

  private read(): WallpaperEngineState {
    try {
      return normalizeState(JSON.parse(fs.readFileSync(this.filePath, 'utf8')))
    } catch {
      return normalizeState(DEFAULT_WALLPAPER_ENGINE_STATE)
    }
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), 'utf8')
    fs.renameSync(temporary, this.filePath)
  }
}

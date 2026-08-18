export const WALLPAPER_ENGINE_STATE_VERSION = 1 as const
export const WALLPAPER_ENGINE_SCHEME = 'flux-wallpaper' as const

export type WallpaperEngineProjectType = 'video' | 'image' | 'scene' | 'web' | 'application' | 'unknown'

export type WallpaperEngineMediaType = 'video' | 'image' | null
export type WallpaperEngineSafetyMode = 'direct-media' | 'native-engine' | 'preview-only'
export type WallpaperEngineSelectionKind = 'media' | 'engine'
export type WallpaperEngineRuntimePhase =
  | 'idle'
  | 'starting'
  | 'active'
  | 'suspended'
  | 'recovering'
  | 'failed'

export interface WallpaperEngineProject {
  id: string
  title: string
  projectType: WallpaperEngineProjectType
  mediaType: WallpaperEngineMediaType
  playable: boolean
  enginePlayable: boolean
  previewOnly: boolean
  hasPreview: boolean
  previewAnimated: boolean
  source: 'workshop' | 'local' | 'imported'
  sourceLabel: string
  workshopId: string
  propertyCount: number
  audioPropertyCount: number
  mutedAudioPropertyCount: number
  updatedAt: number
  safetyMode: WallpaperEngineSafetyMode
  previewUrl: string
  mediaUrl: string
}

export interface WallpaperEngineManualRoot {
  id: string
  name: string
}

export interface WallpaperEngineRuntimeProbe {
  available: boolean
  reason: string
  executableName: string
}

export interface WallpaperEngineLibrarySnapshot {
  version: typeof WALLPAPER_ENGINE_STATE_VERSION
  ok: boolean
  projects: WallpaperEngineProject[]
  count: number
  dynamicCount: number
  enginePlayableCount: number
  previewOnlyCount: number
  sourceCount: number
  manualRoots: WallpaperEngineManualRoot[]
  scannedAt: number
  elapsedMs: number
  runtime: WallpaperEngineRuntimeProbe
}

export interface WallpaperEngineSelection {
  version: typeof WALLPAPER_ENGINE_STATE_VERSION
  active: boolean
  id: string
  title: string
  kind: WallpaperEngineSelectionKind
  mediaType: Exclude<WallpaperEngineMediaType, null> | 'image'
  projectType: WallpaperEngineProjectType
  updatedAt: number
  runtimeError: string
}

export interface WallpaperEngineState {
  version: typeof WALLPAPER_ENGINE_STATE_VERSION
  selection: WallpaperEngineSelection
  favorites: string[]
  hidden: string[]
}

export interface WallpaperEngineProjectProperty {
  key: string
  label: string
  type: string
  value: boolean | number | string | null
  audio: boolean
  autoMuted: boolean
  min?: number
  max?: number
  step?: number
  options?: Array<{ label: string; value: boolean | number | string }>
}

export interface WallpaperEngineProjectDetails {
  ok: boolean
  id: string
  title: string
  projectType: WallpaperEngineProjectType
  workshopId: string
  propertyCount: number
  audioPropertyCount: number
  mutedAudioPropertyCount: number
  properties: WallpaperEngineProjectProperty[]
}

export interface WallpaperEngineRuntimeStatus {
  ok: boolean
  active: boolean
  mode: 'none' | 'media' | 'dwm'
  phase: WallpaperEngineRuntimePhase
  sessionId: string
  projectId: string
  glassSamplerAvailable: boolean
  error: string
}

export type WallpaperEngineStateCommand =
  | { action: 'select'; id: string }
  | { action: 'clear' }
  | { action: 'favorite'; id: string; active: boolean }
  | { action: 'hide'; id: string }
  | { action: 'unhide'; id: string }
  | { action: 'restore-hidden' }
  | { action: 'runtime-error'; id: string; error: string }

export interface WallpaperEngineCommandResult {
  ok: boolean
  canceled?: boolean
  error?: string
  snapshot?: WallpaperEngineLibrarySnapshot
  state?: WallpaperEngineState
}

export const DEFAULT_WALLPAPER_ENGINE_SELECTION: WallpaperEngineSelection = Object.freeze({
  version: WALLPAPER_ENGINE_STATE_VERSION,
  active: false,
  id: '',
  title: '',
  kind: 'media',
  mediaType: 'image',
  projectType: 'unknown',
  updatedAt: 0,
  runtimeError: '',
})

export const DEFAULT_WALLPAPER_ENGINE_STATE: WallpaperEngineState = Object.freeze({
  version: WALLPAPER_ENGINE_STATE_VERSION,
  selection: DEFAULT_WALLPAPER_ENGINE_SELECTION,
  favorites: [],
  hidden: [],
})

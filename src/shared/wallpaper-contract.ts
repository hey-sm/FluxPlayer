/**
 * M5 wallpaper ABI. This snapshot is deliberately low frequency: no analyser bins,
 * cover bitmap, WebGL texture, pixel frame or other render-frame data may cross IPC.
 */
export const WALLPAPER_STATE_VERSION = 1 as const
export const WALLPAPER_PUSH_INTERVAL_MS = 100
export const WALLPAPER_OCCLUSION_INTERVAL_MS = 2_000

export type WallpaperPreset = 0 | 1 | 2 | 3 | 4 | 5

export interface WallpaperTheme {
  id: string
  accentColor: string
}

export interface WallpaperVisualParams {
  intensity: number
  depth: number
  pointScale: number
  speed: number
  twist: number
  colorBoost: number
  scatter: number
  coverResolution: number
  backgroundFade: number
  bloomStrength: number
  bloomSize: number
  tintStrength: number
  alpha: number
  particleDim: number
}

export interface WallpaperState {
  version: typeof WALLPAPER_STATE_VERSION
  enabled: boolean
  playing: boolean
  beatPulse: number
  theme: WallpaperTheme
  preset: WallpaperPreset
  params: WallpaperVisualParams
  /** True only when a foreground full-screen window covers the primary monitor. */
  suspended: boolean
  /** Monotonic main-process revision. Renderer input may not set it directly. */
  revision: number
}

export type WallpaperStatePatch = Partial<
  Pick<WallpaperState, 'playing' | 'beatPulse' | 'preset' | 'suspended'>
> & {
  theme?: Partial<WallpaperTheme>
  params?: Partial<WallpaperVisualParams>
}

export type WallpaperAttachMode = 'workerw' | 'bottom' | 'disabled' | 'unsupported'

export interface WallpaperCommandResult {
  ok: boolean
  state: WallpaperState
  mode: WallpaperAttachMode
  error?: string
}

export const DEFAULT_WALLPAPER_PARAMS: Readonly<WallpaperVisualParams> = Object.freeze({
  intensity: 0.85,
  depth: 1,
  pointScale: 1,
  speed: 1,
  twist: 0,
  colorBoost: 1.1,
  scatter: 0,
  coverResolution: 1,
  backgroundFade: 0.2,
  bloomStrength: 0.62,
  bloomSize: 2.65,
  tintStrength: 0,
  alpha: 1,
  particleDim: 1,
})

export const DEFAULT_WALLPAPER_STATE: Readonly<WallpaperState> = Object.freeze({
  version: WALLPAPER_STATE_VERSION,
  enabled: false,
  playing: false,
  beatPulse: 0,
  theme: Object.freeze({ id: 'obsidian', accentColor: '#7c8cff' }),
  preset: 2,
  params: DEFAULT_WALLPAPER_PARAMS,
  suspended: false,
  revision: 0,
})

const PARAM_KEYS = Object.freeze(
  Object.keys(DEFAULT_WALLPAPER_PARAMS) as Array<keyof WallpaperVisualParams>,
)

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function accentColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const next = value.trim()
  return /^#[0-9a-f]{6}$/i.test(next) ? next.toLowerCase() : fallback
}

function presetValue(value: unknown, fallback: WallpaperPreset): WallpaperPreset {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 5
    ? (value as WallpaperPreset)
    : fallback
}

export function normalizeWallpaperStatePatch(
  input: unknown,
  base: Readonly<WallpaperState> = DEFAULT_WALLPAPER_STATE,
): WallpaperStatePatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const value = input as Record<string, unknown>
  const patch: WallpaperStatePatch = {}

  if ('playing' in value) patch.playing = booleanValue(value.playing, base.playing)
  if ('beatPulse' in value) {
    patch.beatPulse = Math.max(0, Math.min(1, finiteNumber(value.beatPulse, base.beatPulse)))
  }
  if ('preset' in value) patch.preset = presetValue(value.preset, base.preset)
  if ('suspended' in value) patch.suspended = booleanValue(value.suspended, base.suspended)

  if (value.theme && typeof value.theme === 'object' && !Array.isArray(value.theme)) {
    const rawTheme = value.theme as Record<string, unknown>
    patch.theme = {
      id:
        typeof rawTheme.id === 'string' && rawTheme.id.trim()
          ? rawTheme.id.trim().slice(0, 64)
          : base.theme.id,
      accentColor: accentColor(rawTheme.accentColor, base.theme.accentColor),
    }
  }

  if (value.params && typeof value.params === 'object' && !Array.isArray(value.params)) {
    const rawParams = value.params as Record<string, unknown>
    const params: Partial<WallpaperVisualParams> = {}
    for (const key of PARAM_KEYS) {
      if (key in rawParams) params[key] = finiteNumber(rawParams[key], base.params[key])
    }
    patch.params = params
  }

  return patch
}

/** Main-process merge: enabled is controlled separately and revision is always monotonic. */
export function mergeWallpaperState(
  base: Readonly<WallpaperState>,
  input: unknown,
  enabled: boolean = base.enabled,
): WallpaperState {
  const patch = normalizeWallpaperStatePatch(input, base)
  return {
    version: WALLPAPER_STATE_VERSION,
    enabled,
    playing: patch.playing ?? base.playing,
    beatPulse: patch.beatPulse ?? base.beatPulse,
    theme: { ...base.theme, ...patch.theme },
    preset: patch.preset ?? base.preset,
    params: { ...base.params, ...patch.params },
    suspended: patch.suspended ?? base.suspended,
    revision: Math.max(0, Math.trunc(base.revision)) + 1,
  }
}

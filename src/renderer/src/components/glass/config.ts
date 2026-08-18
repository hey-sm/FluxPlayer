export interface GlassConfig {
  blur: number
  distortion: number
  flexibility: number
  borderColor: string
  borderSize: number
  borderRadius: number
  borderOpacity: number
  backgroundColor: string
  backgroundOpacity: number
  innerLightColor: string
  innerLightSpread: number
  innerLightBlur: number
  innerLightOpacity: number
  outerLightColor: string
  outerLightSpread: number
  outerLightBlur: number
  outerLightOpacity: number
  color: string
  chromaticAberration: number
  onHoverScale: number
  saturation: number
  brightness: number
}

export type GlassEditablePatch = Partial<Omit<GlassConfig, 'flexibility' | 'onHoverScale'>>

export const DEFAULT_GLASS_CONFIG = Object.freeze({
  blur: 10,
  distortion: 40,
  flexibility: 0,
  borderColor: '#ffffff',
  borderSize: 1,
  borderRadius: 30,
  borderOpacity: 0,
  backgroundColor: '#000000ff',
  backgroundOpacity: 0,
  innerLightColor: '#ffffff',
  innerLightSpread: 1,
  innerLightBlur: 10,
  innerLightOpacity: 0,
  outerLightColor: '#ffffff',
  outerLightSpread: 1,
  outerLightBlur: 10,
  outerLightOpacity: 0,
  color: '#ffffff',
  chromaticAberration: 0,
  onHoverScale: 1,
  saturation: 100,
  brightness: 100,
} satisfies GlassConfig)

export const GLASS_CONFIG_LIMITS = Object.freeze({
  blur: [0, 40],
  distortion: [0, 100],
  borderSize: [0, 4],
  borderRadius: [0, 60],
  borderOpacity: [0, 1],
  backgroundOpacity: [0, 1],
  innerLightSpread: [0, 20],
  innerLightBlur: [0, 80],
  innerLightOpacity: [0, 1],
  outerLightSpread: [0, 20],
  outerLightBlur: [0, 80],
  outerLightOpacity: [0, 1],
  chromaticAberration: [0, 20],
  saturation: [50, 200],
  brightness: [50, 150],
} as const)

const COLOR_KEYS = Object.freeze([
  'borderColor',
  'backgroundColor',
  'innerLightColor',
  'outerLightColor',
  'color',
] as const)

const NUMBER_KEYS = Object.freeze(Object.keys(GLASS_CONFIG_LIMITS) as (keyof typeof GLASS_CONFIG_LIMITS)[])
const CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_GLASS_CONFIG) as (keyof GlassConfig)[])
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeGlassColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : null
}

function isNumberInRange(key: keyof typeof GLASS_CONFIG_LIMITS, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const [minimum, maximum] = GLASS_CONFIG_LIMITS[key]
  return value >= minimum && value <= maximum
}

function clampNumber(key: keyof typeof GLASS_CONFIG_LIMITS, value: number): number {
  const [minimum, maximum] = GLASS_CONFIG_LIMITS[key]
  return Math.min(maximum, Math.max(minimum, value))
}

/** Normalizes untrusted persisted data and falls back independently for every field. */
export function normalizeGlassConfig(
  value: unknown,
  fallback: Readonly<GlassConfig> = DEFAULT_GLASS_CONFIG,
): GlassConfig {
  const source = isRecord(value) ? value : {}
  const normalized = { ...fallback }

  for (const key of COLOR_KEYS) normalized[key] = normalizeGlassColor(source[key]) ?? fallback[key]
  for (const key of NUMBER_KEYS) {
    normalized[key] = isNumberInRange(key, source[key]) ? source[key] : fallback[key]
  }

  normalized.flexibility = 0
  normalized.onHoverScale = 1
  return normalized
}

/** Applies trusted UI patches, clamping finite numeric values to the public safe range. */
export function patchGlassConfig(
  current: Readonly<GlassConfig>,
  patch: GlassEditablePatch | Partial<GlassConfig>,
): GlassConfig {
  const source = patch as Partial<Record<keyof GlassConfig, unknown>>
  const next = { ...current }

  for (const key of COLOR_KEYS) {
    if (source[key] !== undefined) next[key] = normalizeGlassColor(source[key]) ?? current[key]
  }
  for (const key of NUMBER_KEYS) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) next[key] = clampNumber(key, value)
  }

  next.flexibility = 0
  next.onHoverScale = 1
  return next
}

export function equalGlassConfig(left: Readonly<GlassConfig>, right: Readonly<GlassConfig>): boolean {
  return CONFIG_KEYS.every((key) => left[key] === right[key])
}

export const GLASS_CSS_VARIABLE_NAMES = Object.freeze({
  blur: '--flux-glass-blur',
  distortion: '--flux-glass-distortion',
  borderColor: '--flux-glass-border-color',
  borderSize: '--flux-glass-border-size',
  borderRadius: '--flux-glass-radius',
  borderOpacity: '--flux-glass-border-opacity',
  backgroundColor: '--flux-glass-background-color',
  backgroundOpacity: '--flux-glass-bg-opacity',
  innerLightColor: '--flux-glass-inner-light-color',
  innerLightSpread: '--flux-glass-inner-light-spread',
  innerLightBlur: '--flux-glass-inner-light-blur',
  innerLightOpacity: '--flux-glass-inner-light-opacity',
  outerLightColor: '--flux-glass-outer-light-color',
  outerLightSpread: '--flux-glass-outer-light-spread',
  outerLightBlur: '--flux-glass-outer-light-blur',
  outerLightOpacity: '--flux-glass-outer-light-opacity',
  color: '--flux-glass-color',
  chromaticAberration: '--flux-glass-chromatic-aberration',
  saturation: '--flux-glass-saturation',
  brightness: '--flux-glass-brightness',
} as const)

export type GlassCssVariables = Readonly<
  Record<(typeof GLASS_CSS_VARIABLE_NAMES)[keyof typeof GLASS_CSS_VARIABLE_NAMES], string>
>

export function glassConfigToCssVariables(config: Readonly<GlassConfig>): GlassCssVariables {
  return {
    '--flux-glass-blur': `${config.blur}px`,
    '--flux-glass-distortion': String(config.distortion),
    '--flux-glass-border-color': config.borderColor,
    '--flux-glass-border-size': `${config.borderSize}px`,
    '--flux-glass-radius': `${config.borderRadius}px`,
    '--flux-glass-border-opacity': String(config.borderOpacity),
    '--flux-glass-background-color': config.backgroundColor,
    '--flux-glass-bg-opacity': String(config.backgroundOpacity),
    '--flux-glass-inner-light-color': config.innerLightColor,
    '--flux-glass-inner-light-spread': `${config.innerLightSpread}px`,
    '--flux-glass-inner-light-blur': `${config.innerLightBlur}px`,
    '--flux-glass-inner-light-opacity': String(config.innerLightOpacity),
    '--flux-glass-outer-light-color': config.outerLightColor,
    '--flux-glass-outer-light-spread': `${config.outerLightSpread}px`,
    '--flux-glass-outer-light-blur': `${config.outerLightBlur}px`,
    '--flux-glass-outer-light-opacity': String(config.outerLightOpacity),
    '--flux-glass-color': config.color,
    '--flux-glass-chromatic-aberration': String(config.chromaticAberration),
    '--flux-glass-saturation': `${config.saturation}%`,
    '--flux-glass-brightness': `${config.brightness}%`,
  }
}

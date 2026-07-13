import type { ThemeVisualParams, ThemeVisualPatch } from './types'

const PARAM_LIMITS = Object.freeze({
  blur: [0, 40],
  saturation: [80, 180],
  backgroundOpacity: [0, 1],
  borderOpacity: [0, 1],
  distortion: [0, 100],
  chromaticAberration: [0, 20],
  radius: [0, 50],
  fontScale: [0.8, 1.4],
} as const)

const STRING_KEYS = Object.freeze([
  'background',
  'text',
  'textMuted',
  'accent',
  'danger',
  'panelSurface',
  'panelBorder',
  'fontFamily',
] as const)

const NUMBER_KEYS = Object.freeze([
  'blur',
  'saturation',
  'backgroundOpacity',
  'borderOpacity',
  'distortion',
  'chromaticAberration',
  'radius',
  'fontScale',
] as const)

type NumericThemeKey = (typeof NUMBER_KEYS)[number]
type StringThemeKey = (typeof STRING_KEYS)[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512
}

function inRange(key: NumericThemeKey, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const [minimum, maximum] = PARAM_LIMITS[key]
  return value >= minimum && value <= maximum
}

function clamp(key: NumericThemeKey, value: number): number {
  const [minimum, maximum] = PARAM_LIMITS[key]
  return Math.min(maximum, Math.max(minimum, value))
}

export function isThemeVisualParams(value: unknown): value is ThemeVisualParams {
  if (!isRecord(value)) return false

  return (
    STRING_KEYS.every((key) => isNonEmptyString(value[key])) &&
    NUMBER_KEYS.every((key) => inRange(key, value[key]))
  )
}

/**
 * Applies a runtime patch without allowing malformed imported settings to poison
 * CSS variables. Invalid strings are ignored; finite numeric values are clamped
 * to the same ranges exposed by the settings UI.
 */
export function patchThemeVisualParams(
  current: Readonly<ThemeVisualParams>,
  patch: ThemeVisualPatch,
): ThemeVisualParams {
  const next: ThemeVisualParams = { ...current }
  const candidate = patch as Partial<Record<keyof ThemeVisualParams, unknown>>

  for (const key of STRING_KEYS) {
    const value = candidate[key]
    if (value !== undefined && isNonEmptyString(value)) {
      next[key as StringThemeKey] = value
    }
  }

  for (const key of NUMBER_KEYS) {
    const value = candidate[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      next[key] = clamp(key, value)
    }
  }

  return next
}

export function equalThemeVisualParams(
  left: Readonly<ThemeVisualParams>,
  right: Readonly<ThemeVisualParams>,
): boolean {
  return (
    STRING_KEYS.every((key) => left[key] === right[key]) &&
    NUMBER_KEYS.every((key) => left[key] === right[key])
  )
}

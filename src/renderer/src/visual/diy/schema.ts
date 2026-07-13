import { DEFAULT_VISUAL_PARAMS, type VisualParams } from '../bus'

export type DiyVisualParamKey = keyof VisualParams

export interface DiyVisualParamDefinition {
  readonly default: number
  readonly min: number
  readonly max: number
  readonly step: number
  /** Field names used by the legacy DIY console persistence object. */
  readonly legacyKeys: readonly string[]
}

type DiyVisualParamSchema = Readonly<{
  [Key in DiyVisualParamKey]: DiyVisualParamDefinition
}>

function defineParam(
  defaultValue: number,
  min: number,
  max: number,
  step = 0.01,
  legacyKeys: readonly string[] = [],
): DiyVisualParamDefinition {
  return Object.freeze({
    default: defaultValue,
    min,
    max,
    step,
    legacyKeys: Object.freeze([...legacyKeys]),
  })
}

/**
 * The serializable DIY domain. Its keys intentionally match VisualBus.params exactly.
 * Theme colors, glass tokens, fonts, presets and other UI settings do not belong here.
 * User-facing ranges and aliases are carried over from the legacy DIY controls.
 */
const diyVisualParamSchema = {
  intensity: defineParam(DEFAULT_VISUAL_PARAMS.intensity, 0.2, 1.6),
  depth: defineParam(DEFAULT_VISUAL_PARAMS.depth, 0.2, 1.8),
  pointScale: defineParam(DEFAULT_VISUAL_PARAMS.pointScale, 0.5, 2.2, 0.01, ['point']),
  speed: defineParam(DEFAULT_VISUAL_PARAMS.speed, 0.2, 2.5),
  twist: defineParam(DEFAULT_VISUAL_PARAMS.twist, 0, 0.6),
  colorBoost: defineParam(DEFAULT_VISUAL_PARAMS.colorBoost, 0.5, 2, 0.01, ['color']),
  scatter: defineParam(DEFAULT_VISUAL_PARAMS.scatter, 0, 0.5),
  coverResolution: defineParam(DEFAULT_VISUAL_PARAMS.coverResolution, 0.75, 1.55, 0.01, [
    'coverRes',
  ]),
  backgroundFade: defineParam(DEFAULT_VISUAL_PARAMS.backgroundFade, 0, 1.2, 0.01, ['bgFade']),
  bloomStrength: defineParam(DEFAULT_VISUAL_PARAMS.bloomStrength, 0, 1.6),
  bloomSize: defineParam(DEFAULT_VISUAL_PARAMS.bloomSize, 0.5, 6),
  tintStrength: defineParam(DEFAULT_VISUAL_PARAMS.tintStrength, 0, 1, 0.01, [
    'visualTintStrength',
  ]),
  alpha: defineParam(DEFAULT_VISUAL_PARAMS.alpha, 0, 1),
  particleDim: defineParam(DEFAULT_VISUAL_PARAMS.particleDim, 0, 1),
} satisfies DiyVisualParamSchema

export const DIY_VISUAL_PARAM_SCHEMA: DiyVisualParamSchema = Object.freeze(diyVisualParamSchema)

export const DIY_VISUAL_PARAM_KEYS: readonly DiyVisualParamKey[] = Object.freeze(
  Object.keys(DIY_VISUAL_PARAM_SCHEMA) as DiyVisualParamKey[],
)

const diyVisualParamKeySet: ReadonlySet<string> = new Set(DIY_VISUAL_PARAM_KEYS)

export const DEFAULT_DIY_VISUAL_PARAMS: Readonly<VisualParams> = Object.freeze({
  ...DEFAULT_VISUAL_PARAMS,
})

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function payloadParams(value: unknown): UnknownRecord | null {
  if (!isRecord(value)) return null

  // v1 uses `params`; the `values` envelope and a raw object are accepted for v0 migration.
  if (isRecord(value.params)) return value.params
  if (isRecord(value.values)) return value.values
  return value
}

export function isDiyVisualParamKey(value: unknown): value is DiyVisualParamKey {
  return typeof value === 'string' && diyVisualParamKeySet.has(value)
}

export function clampDiyVisualParam(
  key: DiyVisualParamKey,
  value: unknown,
  fallback: number = DIY_VISUAL_PARAM_SCHEMA[key].default,
): number {
  const definition = DIY_VISUAL_PARAM_SCHEMA[key]
  const safeFallback = finiteNumber(fallback) ?? definition.default
  const numeric = finiteNumber(value) ?? safeFallback
  return Math.max(definition.min, Math.min(definition.max, numeric))
}

/**
 * Migrates legacy aliases, drops unknown fields and returns one complete, clamped snapshot.
 * Invalid or missing values retain the supplied base (the canonical defaults by default).
 */
export function migrateDiyVisualParams(
  value: unknown,
  base: Readonly<VisualParams> = DEFAULT_DIY_VISUAL_PARAMS,
): VisualParams {
  const source = payloadParams(value)
  const result = {} as VisualParams

  for (const key of DIY_VISUAL_PARAM_KEYS) {
    const definition = DIY_VISUAL_PARAM_SCHEMA[key]
    const fallback = clampDiyVisualParam(key, base[key], definition.default)
    let rawValue: unknown = fallback

    if (source && hasOwn(source, key)) {
      rawValue = source[key]
    } else if (source) {
      const alias = definition.legacyKeys.find((legacyKey) => hasOwn(source, legacyKey))
      if (alias !== undefined) rawValue = source[alias]
    }

    result[key] = clampDiyVisualParam(key, rawValue, fallback)
  }

  return result
}

/** Parses persisted JSON without ever leaking parse errors or non-finite/out-of-range values. */
export function parseDiyVisualParams(
  raw: string | null | undefined,
  fallback: Readonly<VisualParams> = DEFAULT_DIY_VISUAL_PARAMS,
): VisualParams {
  if (!raw || raw.trim() === '') return migrateDiyVisualParams(null, fallback)

  try {
    return migrateDiyVisualParams(JSON.parse(raw) as unknown, fallback)
  } catch {
    return migrateDiyVisualParams(null, fallback)
  }
}

export function equalDiyVisualParams(
  left: Readonly<VisualParams>,
  right: Readonly<VisualParams>,
): boolean {
  return DIY_VISUAL_PARAM_KEYS.every((key) => left[key] === right[key])
}

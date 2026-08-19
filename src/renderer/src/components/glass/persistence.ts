import { DEFAULT_GLASS_CONFIG, equalGlassConfig, normalizeGlassConfig, type GlassConfig } from './config'

export const GLASS_PERSISTENCE_KEY = 'fluxplayer-glass-v1'
export const GLASS_PERSISTENCE_VERSION = 3 as const
const PREVIOUS_GLASS_PERSISTENCE_VERSION = 2 as const
const LEGACY_GLASS_PERSISTENCE_VERSION = 1 as const

const PREVIOUS_DEFAULT_GLASS_CONFIG = Object.freeze({
  ...DEFAULT_GLASS_CONFIG,
  distortion: 40,
  borderRadius: 30,
  innerLightSpread: 1,
  innerLightBlur: 10,
  innerLightOpacity: 0,
  outerLightSpread: 1,
  outerLightBlur: 10,
} satisfies GlassConfig)

export interface GlassStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function isGlassStorage(value: unknown): value is GlassStorage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<GlassStorage>
  return typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function'
}

export function getBrowserGlassStorage(): GlassStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: unknown }).localStorage
    return isGlassStorage(candidate) ? candidate : null
  } catch {
    return null
  }
}

export function serializeGlassConfig(config: Readonly<GlassConfig>): string {
  return JSON.stringify({ version: GLASS_PERSISTENCE_VERSION, config })
}

export function deserializeGlassConfig(raw: string | null | undefined): GlassConfig | null {
  if (!raw) return null
  try {
    const envelope = JSON.parse(raw) as { version?: unknown; config?: unknown } | null
    if (!envelope) return null
    if (envelope.version === GLASS_PERSISTENCE_VERSION) {
      return normalizeGlassConfig(envelope.config, DEFAULT_GLASS_CONFIG)
    }
    if (envelope.version === PREVIOUS_GLASS_PERSISTENCE_VERSION) {
      const config = normalizeGlassConfig(envelope.config, DEFAULT_GLASS_CONFIG)
      return equalGlassConfig(config, PREVIOUS_DEFAULT_GLASS_CONFIG) ? { ...DEFAULT_GLASS_CONFIG } : config
    }
    if (envelope.version === LEGACY_GLASS_PERSISTENCE_VERSION) {
      return {
        ...normalizeGlassConfig(envelope.config, DEFAULT_GLASS_CONFIG),
        blur: DEFAULT_GLASS_CONFIG.blur,
        borderOpacity: DEFAULT_GLASS_CONFIG.borderOpacity,
      }
    }
    return null
  } catch {
    return null
  }
}

export function loadPersistedGlassConfig(
  storage: GlassStorage | null = getBrowserGlassStorage(),
): GlassConfig | null {
  if (!storage) return null
  try {
    return deserializeGlassConfig(storage.getItem(GLASS_PERSISTENCE_KEY))
  } catch {
    return null
  }
}

export function savePersistedGlassConfig(
  config: Readonly<GlassConfig>,
  storage: GlassStorage | null = getBrowserGlassStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(GLASS_PERSISTENCE_KEY, serializeGlassConfig(config))
    return true
  } catch {
    return false
  }
}

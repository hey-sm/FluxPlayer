import { DEFAULT_GLASS_CONFIG, normalizeGlassConfig, type GlassConfig } from './config'

export const GLASS_PERSISTENCE_KEY = 'fluxplayer-glass-v1'
export const GLASS_PERSISTENCE_VERSION = 2 as const
const LEGACY_GLASS_PERSISTENCE_VERSION = 1 as const

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

import { snapshotFromPreset } from './presets'
import type { ThemeSnapshot } from './types'

export const THEME_PERSISTENCE_KEY = 'fluxplayer-theme-v1'
export const THEME_PERSISTENCE_VERSION = 1 as const

export interface ThemeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function isThemeStorage(value: unknown): value is ThemeStorage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ThemeStorage>
  return typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function'
}

export function getBrowserThemeStorage(): ThemeStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: unknown }).localStorage
    return isThemeStorage(candidate) ? candidate : null
  } catch {
    return null
  }
}

export function serializePersistedTheme(_snapshot: ThemeSnapshot): string {
  return JSON.stringify({ version: THEME_PERSISTENCE_VERSION, selectedPresetId: 'classic-gold' })
}

/** V1 presets and custom snapshots are intentionally migrated to the sole classic theme. */
export function deserializePersistedTheme(raw: string | null | undefined): ThemeSnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { version?: unknown } | null
    return parsed && parsed.version === THEME_PERSISTENCE_VERSION ? snapshotFromPreset() : null
  } catch {
    return null
  }
}

export function loadPersistedTheme(
  storage: ThemeStorage | null = getBrowserThemeStorage(),
): ThemeSnapshot | null {
  if (!storage) return null
  try {
    return deserializePersistedTheme(storage.getItem(THEME_PERSISTENCE_KEY))
  } catch {
    return null
  }
}

export function savePersistedTheme(
  snapshot: ThemeSnapshot,
  storage: ThemeStorage | null = getBrowserThemeStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(THEME_PERSISTENCE_KEY, serializePersistedTheme(snapshot))
    return true
  } catch {
    return false
  }
}

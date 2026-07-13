import type { ThemeSnapshot } from './types'
import { isThemePresetId } from './presets'
import { isThemeVisualParams } from './values'

export const THEME_PERSISTENCE_KEY = 'fluxplayer-theme-v1'
export const THEME_PERSISTENCE_VERSION = 1 as const

export interface ThemeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PersistedThemeV1 extends ThemeSnapshot {
  version: typeof THEME_PERSISTENCE_VERSION
}

function isThemeStorage(value: unknown): value is ThemeStorage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ThemeStorage>
  return typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function'
}

/** Safely resolves localStorage. Its getter can throw in locked-down renderers. */
export function getBrowserThemeStorage(): ThemeStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: unknown }).localStorage
    return isThemeStorage(candidate) ? candidate : null
  } catch {
    return null
  }
}

export function serializePersistedTheme(snapshot: ThemeSnapshot): string {
  const payload: PersistedThemeV1 = {
    version: THEME_PERSISTENCE_VERSION,
    selectedPresetId: snapshot.selectedPresetId,
    visualParams: { ...snapshot.visualParams },
  }
  return JSON.stringify(payload)
}

export function deserializePersistedTheme(raw: string | null | undefined): ThemeSnapshot | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedThemeV1> | null
    if (
      !parsed ||
      parsed.version !== THEME_PERSISTENCE_VERSION ||
      !isThemePresetId(parsed.selectedPresetId) ||
      !isThemeVisualParams(parsed.visualParams)
    ) {
      return null
    }

    return {
      selectedPresetId: parsed.selectedPresetId,
      visualParams: { ...parsed.visualParams },
    }
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

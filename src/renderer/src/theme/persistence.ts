import { snapshotFromPreset } from './presets'
import type { ThemeSnapshot } from './types'
import { isThemeVisualParams, normalizeHexColor, patchThemeVisualParams } from './values'

export const THEME_PERSISTENCE_KEY = 'fluxplayer-theme-v1'
export const THEME_PERSISTENCE_VERSION = 3 as const

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

export function serializePersistedTheme(snapshot: ThemeSnapshot): string {
  return JSON.stringify({ version: THEME_PERSISTENCE_VERSION, ...snapshot })
}

function deserializeLyricsState(parsed: Record<string, unknown>): {
  lyricsColor: string
  lyricsColorLinked: boolean
} | null {
  const lyricsColor = normalizeHexColor(parsed.lyricsColor)
  if (!lyricsColor || typeof parsed.lyricsColorLinked !== 'boolean') return null
  return { lyricsColor, lyricsColorLinked: parsed.lyricsColorLinked }
}

/** V1 resets to the preset; V2 keeps theme values while discarding its legacy glass fields. */
export function deserializePersistedTheme(raw: string | null | undefined): ThemeSnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null
    if (!parsed) return null
    if (parsed.version === 1) return snapshotFromPreset()
    if (parsed.version === 2 && parsed.selectedPresetId === 'classic-gold') {
      const lyricsState = deserializeLyricsState(parsed)
      if (!lyricsState || typeof parsed.visualParams !== 'object' || parsed.visualParams === null) return null
      const defaults = snapshotFromPreset()
      return {
        selectedPresetId: 'classic-gold',
        visualParams: patchThemeVisualParams(
          defaults.visualParams,
          parsed.visualParams as Partial<typeof defaults.visualParams>,
        ),
        ...lyricsState,
      }
    }
    if (
      parsed.version !== THEME_PERSISTENCE_VERSION ||
      parsed.selectedPresetId !== 'classic-gold' ||
      !isThemeVisualParams(parsed.visualParams)
    ) {
      return null
    }
    const lyricsState = deserializeLyricsState(parsed)
    if (!lyricsState) return null
    return {
      selectedPresetId: 'classic-gold',
      visualParams: { ...parsed.visualParams },
      ...lyricsState,
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

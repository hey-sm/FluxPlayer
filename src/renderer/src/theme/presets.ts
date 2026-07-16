import { CLASSIC_GOLD_THEME } from './classic'
import type { ThemePreset, ThemePresetId, ThemeSnapshot, ThemeVisualParams } from './types'

export const DEFAULT_THEME_PRESET_ID: ThemePresetId = 'classic-gold'

Object.freeze(CLASSIC_GOLD_THEME.visualParams)
export const THEME_PRESETS: Readonly<Record<ThemePresetId, ThemePreset>> = Object.freeze({
  'classic-gold': Object.freeze(CLASSIC_GOLD_THEME),
})
export const THEME_PRESET_LIST: readonly ThemePreset[] = Object.freeze([CLASSIC_GOLD_THEME])

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return value === DEFAULT_THEME_PRESET_ID
}

export function getThemePreset(_id: ThemePresetId = DEFAULT_THEME_PRESET_ID): ThemePreset {
  return CLASSIC_GOLD_THEME
}

export function cloneThemeVisualParams(params: Readonly<ThemeVisualParams>): ThemeVisualParams {
  return { ...params }
}

export function snapshotFromPreset(_id: ThemePresetId = DEFAULT_THEME_PRESET_ID): ThemeSnapshot {
  return {
    selectedPresetId: DEFAULT_THEME_PRESET_ID,
    visualParams: cloneThemeVisualParams(CLASSIC_GOLD_THEME.visualParams),
  }
}

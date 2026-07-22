import { WALLPAPER_PRESET } from './wallpaper'
import { CINEMATIC_VISTA_PRESET } from './cinematic-vista'
import type { VisualPresetDefinition } from './types'

export type { VisualPresetDefinition, VisualPresetName } from './types'

/** The product intentionally exposes only the two maintained music visuals. */
export const VISUAL_PRESETS: readonly VisualPresetDefinition[] = Object.freeze([
  WALLPAPER_PRESET,
  CINEMATIC_VISTA_PRESET,
])

export const VISUAL_PRESET_BY_ID: ReadonlyMap<VisualPresetDefinition['id'], VisualPresetDefinition> = new Map(
  VISUAL_PRESETS.map((preset) => [preset.id, preset]),
)

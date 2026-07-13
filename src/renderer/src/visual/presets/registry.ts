import { ORBIT_PRESET } from './orbit'
import { SILK_PRESET } from './silk'
import { TUNNEL_PRESET } from './tunnel'
import { VINYL_PRESET } from './vinyl'
import { VOID_PRESET } from './void'
import { WALLPAPER_PRESET } from './wallpaper'
import type { VisualPresetDefinition } from './types'

export type { VisualPresetDefinition, VisualPresetName } from './types'

/** Numeric IDs are shader ABI and must never be reordered. SKULL remains shader-only at id 6. */
export const VISUAL_PRESETS: readonly VisualPresetDefinition[] = Object.freeze([
  SILK_PRESET,
  TUNNEL_PRESET,
  ORBIT_PRESET,
  VOID_PRESET,
  VINYL_PRESET,
  WALLPAPER_PRESET,
])

export const VISUAL_PRESET_BY_ID: ReadonlyMap<VisualPresetDefinition['id'], VisualPresetDefinition> = new Map(
  VISUAL_PRESETS.map((preset) => [preset.id, preset]),
)

import { CinematicVistaBackground } from './cinematic-vista'
import { CrystalBackground } from './crystal'
import { NebulaBackground } from './nebula'
import { SkylineBackground } from './skyline'
import type { BackgroundPresetId, MusicVisualBackgroundDefinition } from './types'

export const MUSIC_BACKGROUND_DEFINITIONS: readonly MusicVisualBackgroundDefinition[] = Object.freeze([
  Object.freeze({ id: 7, create: () => new NebulaBackground() }),
  Object.freeze({ id: 8, create: () => new CrystalBackground() }),
  Object.freeze({ id: 9, create: () => new SkylineBackground() }),
  Object.freeze({ id: 10, create: () => new CinematicVistaBackground() }),
])

export const MUSIC_BACKGROUND_BY_PRESET: ReadonlyMap<BackgroundPresetId, MusicVisualBackgroundDefinition> =
  new Map(MUSIC_BACKGROUND_DEFINITIONS.map((definition) => [definition.id, definition]))

export function isMusicBackgroundPreset(preset: number): preset is BackgroundPresetId {
  return MUSIC_BACKGROUND_BY_PRESET.has(preset as BackgroundPresetId)
}

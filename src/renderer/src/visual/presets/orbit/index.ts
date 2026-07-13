import { CLASSIC_PRESET_TRANSITION, type VisualPresetDefinition } from '../types'

/** ORBIT shader ABI 2. Values are copied from legacy setPreset()/presetMeta. */
export const ORBIT_PRESET: Readonly<VisualPresetDefinition> = Object.freeze({
  id: 2,
  name: 'ORBIT',
  label: '星球',
  description: '星球 · 雕塑感',
  camera: Object.freeze({ radius: 7, phi: 0.15, theta: 0 }),
  transition: CLASSIC_PRESET_TRANSITION,
})
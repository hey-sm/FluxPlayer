import { CLASSIC_PRESET_TRANSITION, type VisualPresetDefinition } from '../types'

/** SILK shader ABI 0. Values are copied from legacy setPreset()/presetMeta. */
export const SILK_PRESET: Readonly<VisualPresetDefinition> = Object.freeze({
  id: 0,
  name: 'SILK',
  label: 'emily专辑封面',
  description: '封面粒子 · 快速入场',
  camera: Object.freeze({ radius: 6.6, phi: 0.08, theta: 0 }),
  transition: CLASSIC_PRESET_TRANSITION,
})

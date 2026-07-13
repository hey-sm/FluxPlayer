import { CLASSIC_PRESET_TRANSITION, type VisualPresetDefinition } from '../types'

/** VOID shader ABI 3. Values are copied from legacy setPreset()/presetMeta. */
export const VOID_PRESET: Readonly<VisualPresetDefinition> = Object.freeze({
  id: 3,
  name: 'VOID',
  label: '虚空',
  description: '无粒子 · 自定义背景',
  camera: Object.freeze({ radius: 8, phi: 0.05, theta: 0 }),
  transition: CLASSIC_PRESET_TRANSITION,
})

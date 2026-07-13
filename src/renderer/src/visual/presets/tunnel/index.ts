import { CLASSIC_PRESET_TRANSITION, type VisualPresetDefinition } from '../types'

/** TUNNEL shader ABI 1. Values are copied from legacy setPreset()/presetMeta. */
export const TUNNEL_PRESET: Readonly<VisualPresetDefinition> = Object.freeze({
  id: 1,
  name: 'TUNNEL',
  label: '滚筒',
  description: '隧道 · 沉浸感',
  camera: Object.freeze({ radius: 6.2, phi: 0.03, theta: 0 }),
  transition: CLASSIC_PRESET_TRANSITION,
})

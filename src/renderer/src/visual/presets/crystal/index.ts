import { CLASSIC_PRESET_TRANSITION, type VisualPresetDefinition } from '../types'

export const CRYSTAL_PRESET: Readonly<VisualPresetDefinition> = Object.freeze({
  id: 8, name: 'CRYSTAL', label: '晶体波场', description: '随中高频起伏的晶体波浪场',
  camera: Object.freeze({ radius: 7.8, phi: 0.38, theta: 0 }), transition: CLASSIC_PRESET_TRANSITION,
})

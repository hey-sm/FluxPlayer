import { CLASSIC_PRESET_TRANSITION, type VisualPresetDefinition } from '../types'

export const NEBULA_PRESET: Readonly<VisualPresetDefinition> = Object.freeze({
  id: 7, name: 'NEBULA', label: '星云隧道', description: '实例化星尘构成的节拍空间隧道',
  camera: Object.freeze({ radius: 7.6, phi: 0.02, theta: 0 }), transition: CLASSIC_PRESET_TRANSITION,
})

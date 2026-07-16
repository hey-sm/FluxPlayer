import { CLASSIC_PRESET_TRANSITION, type VisualPresetDefinition } from '../types'

export const SKYLINE_PRESET: Readonly<VisualPresetDefinition> = Object.freeze({
  id: 9, name: 'SKYLINE', label: '几何天际线', description: '低频驱动的环形几何城市',
  camera: Object.freeze({ radius: 8.4, phi: 0.28, theta: 0 }), transition: CLASSIC_PRESET_TRANSITION,
})

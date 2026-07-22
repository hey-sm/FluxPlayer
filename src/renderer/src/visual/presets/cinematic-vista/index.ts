import { CLASSIC_PRESET_TRANSITION, type VisualPresetDefinition } from '../types'

export const CINEMATIC_VISTA_PRESET: Readonly<VisualPresetDefinition> = Object.freeze({
  id: 10,
  name: 'CINEMATIC_VISTA',
  label: '电影远景',
  description: '雾中巨构 · 封面之窗',
  camera: Object.freeze({ radius: 11.2, phi: 0.055, theta: 0 }),
  transition: Object.freeze({
    ...CLASSIC_PRESET_TRANSITION,
    cameraPunch: 0.035,
    peakScatter: 0.04,
  }),
})

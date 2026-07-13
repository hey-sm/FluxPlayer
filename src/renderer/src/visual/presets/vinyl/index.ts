import type { VisualPresetDefinition } from '../types'

/** VINYL shader ABI 4. Values are copied from legacy setPreset()/presetMeta. */
export const VINYL_PRESET: Readonly<VisualPresetDefinition> = Object.freeze({
  id: 4,
  name: 'VINYL',
  label: '唱片',
  description: '唱片 · 圆形封面',
  camera: Object.freeze({ radius: 6.5, phi: 0.04, theta: 0 }),
  transition: Object.freeze({
    duration: 0.24,
    initialScatter: 0.024,
    initialBurst: 0.15,
    cameraPunch: 0.12,
    peakScatter: 0.026,
    peakBurst: 0.12,
    pointScaleBoost: 0.048,
  }),
})

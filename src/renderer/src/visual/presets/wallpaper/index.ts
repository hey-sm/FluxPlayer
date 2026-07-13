import type { VisualPresetDefinition } from '../types'

/** WALLPAPER shader ABI 5. Values are copied from legacy setPreset()/presetMeta. */
export const WALLPAPER_PRESET: Readonly<VisualPresetDefinition> = Object.freeze({
  id: 5,
  name: 'WALLPAPER',
  label: '星河',
  description: '壁纸粒子 · 音乐律动',
  camera: Object.freeze({ radius: 9.4, phi: 0.34, theta: -0.52 }),
  transition: Object.freeze({
    duration: 0.3,
    initialScatter: 0.008,
    initialBurst: 0.05,
    cameraPunch: 0.04,
    peakScatter: 0.008,
    peakBurst: 0.045,
    pointScaleBoost: 0.016,
  }),
})

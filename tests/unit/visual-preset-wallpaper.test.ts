import { describe, expect, it } from 'vitest'
import { WALLPAPER_PRESET } from '@renderer/visual/presets/wallpaper'

describe('WALLPAPER preset', () => {
  it('preserves legacy metadata and shader ABI', () => {
    expect({
      id: WALLPAPER_PRESET.id,
      name: WALLPAPER_PRESET.name,
      label: WALLPAPER_PRESET.label,
      description: WALLPAPER_PRESET.description,
    }).toEqual({
      id: 5,
      name: 'WALLPAPER',
      label: '星河',
      description: '壁纸粒子 · 音乐律动',
    })
  })

  it('preserves the legacy camera baseline', () => {
    expect(WALLPAPER_PRESET.camera).toEqual({ radius: 9.4, phi: 0.34, theta: -0.52 })
  })

  it('preserves the legacy transition values', () => {
    expect(WALLPAPER_PRESET.transition).toEqual({
      duration: 0.3,
      initialScatter: 0.008,
      initialBurst: 0.05,
      cameraPunch: 0.04,
      peakScatter: 0.008,
      peakBurst: 0.045,
      pointScaleBoost: 0.016,
    })
  })
})

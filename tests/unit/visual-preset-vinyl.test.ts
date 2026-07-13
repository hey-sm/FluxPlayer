import { describe, expect, it } from 'vitest'
import { VINYL_PRESET } from '@renderer/visual/presets/vinyl'

describe('VINYL visual preset', () => {
  it('preserves legacy metadata and shader ABI', () => {
    expect({
      id: VINYL_PRESET.id,
      name: VINYL_PRESET.name,
      label: VINYL_PRESET.label,
      description: VINYL_PRESET.description,
    }).toEqual({
      id: 4,
      name: 'VINYL',
      label: '唱片',
      description: '唱片 · 圆形封面',
    })
  })

  it('preserves the legacy camera baseline', () => {
    expect(VINYL_PRESET.camera).toEqual({ radius: 6.5, phi: 0.04, theta: 0 })
  })

  it('preserves the legacy transition profile', () => {
    expect(VINYL_PRESET.transition).toEqual({
      duration: 0.24,
      initialScatter: 0.024,
      initialBurst: 0.15,
      cameraPunch: 0.12,
      peakScatter: 0.026,
      peakBurst: 0.12,
      pointScaleBoost: 0.048,
    })
  })
})

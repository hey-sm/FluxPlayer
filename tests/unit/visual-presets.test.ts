import { describe, expect, it } from 'vitest'
import { VISUAL_PRESETS } from '@renderer/visual/presets/registry'
import {
  advancePresetTransition,
  beginPresetTransition,
  cameraCartesian,
  legacyEase,
  mapPresetAudio,
} from '@renderer/visual/presets/runtime'
import { CLASSIC_PRESET_TRANSITION } from '@renderer/visual/presets/types'

const closeTo = (value: number, expected: number): void => {
  expect(value).toBeCloseTo(expected, 10)
}

describe('visual preset runtime', () => {
  it('keeps legacy labels, descriptions, and shader ABI order', () => {
    expect(
      VISUAL_PRESETS.slice(0, 6).map(({ id, name, label, description }) => ({ id, name, label, description })),
    ).toEqual([
      { id: 0, name: 'SILK', label: 'emily专辑封面', description: '封面粒子 · 快速入场' },
      { id: 1, name: 'TUNNEL', label: '滚筒', description: '隧道 · 沉浸感' },
      { id: 2, name: 'ORBIT', label: '星球', description: '星球 · 雕塑感' },
      { id: 3, name: 'VOID', label: '虚空', description: '无粒子 · 自定义背景' },
      { id: 4, name: 'VINYL', label: '唱片', description: '唱片 · 圆形封面' },
      { id: 5, name: 'WALLPAPER', label: '星河', description: '壁纸粒子 · 音乐律动' },
    ])
    expect(VISUAL_PRESETS.slice(6).map(({ id, name, label }) => ({ id, name, label }))).toEqual([
      { id: 7, name: 'NEBULA', label: '星云隧道' },
      { id: 8, name: 'CRYSTAL', label: '晶体波场' },
      { id: 9, name: 'SKYLINE', label: '几何天际线' },
    ])
  })

  it('uses the legacy spherical camera convention', () => {
    const position = cameraCartesian({ radius: 9.4, phi: 0.34, theta: -0.52 })
    closeTo(position.x, 9.4 * Math.cos(0.34) * Math.sin(-0.52))
    closeTo(position.y, 9.4 * Math.sin(0.34))
    closeTo(position.z, 9.4 * Math.cos(0.34) * Math.cos(-0.52))
  })

  it('makes legacy fixed-frame easing delta-time independent', () => {
    closeTo(legacyEase(0.1, 1 / 60), 0.1)
    closeTo(legacyEase(0.1, 2 / 60), 0.19)
    expect(legacyEase(0.1, 0)).toBe(0)
  })

  it('keeps regular preset analyser values unchanged', () => {
    const frame = { bass: 0.2, mid: 0.15, treble: 0.1, energy: 0.3, timestamp: 1 }
    expect(mapPresetAudio(frame, 0.3, 2, 0.85)).toEqual({
      bass: 0.2,
      mid: 0.15,
      treble: 0.1,
      beat: 0.3,
    })
  })

  it('applies the frozen VINYL ring mapping', () => {
    const frame = { bass: 0.2, mid: 0.15, treble: 0.1, energy: 0.3, timestamp: 1 }
    const mapped = mapPresetAudio(frame, 0.3, 4, 0.85)
    closeTo(mapped.bass, Math.pow((0.412 - 0.05) / 0.58, 0.72) * 0.85)
    closeTo(mapped.mid, Math.pow((0.238 - 0.045) / 0.46, 0.78) * 0.85)
    closeTo(mapped.treble, Math.pow((0.203 - 0.03) / 0.34, 0.84) * 0.85)
    closeTo(mapped.beat, 0.3)
  })

  it('caps and attenuates the WALLPAPER response', () => {
    const frame = { bass: 1, mid: 1, treble: 1, energy: 1, timestamp: 1 }
    expect(mapPresetAudio(frame, 1, 5, 0.85)).toEqual({
      bass: 0.46 * 0.85,
      mid: 0.4 * 0.85,
      treble: 0.36 * 0.85,
      beat: 0.34,
    })
  })

  it('replays the classic preset transition wave and resets at completion', () => {
    const initial = beginPresetTransition(CLASSIC_PRESET_TRANSITION)
    const peak = advancePresetTransition(initial, 0.12, 0.02, 1.1)
    closeTo(peak.scatter, 0.18)
    closeTo(peak.burst, 0.15)
    closeTo(peak.pointScale, 1.1 * 1.048)
    expect(peak.state).not.toBeNull()

    const complete = advancePresetTransition(peak.state!, 0.12, 0.02, 1.1)
    expect(complete).toEqual({ state: null, scatter: 0.02, burst: 0, pointScale: 1.1 })
  })
})

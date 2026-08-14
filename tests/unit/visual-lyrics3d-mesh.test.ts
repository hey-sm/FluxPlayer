import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { lyricGlyphProgress } from '@renderer/visual/lyrics3d-mesh/highlight'
import { createLyricsMaterial } from '@renderer/visual/lyrics3d-mesh/material'
import {
  LYRICS_FONT_WEIGHT,
  LYRICS_ZOOM_MAX_RADIUS,
  LYRICS_ZOOM_MIN_RADIUS,
} from '@renderer/visual/lyrics3d-mesh/config'

describe('lyrics3d-mesh static material', () => {
  it('uses a front-sided standard material without deformation modes', () => {
    const handle = createLyricsMaterial('#ffffff')
    handle.setHighlight(1.4, 1, new THREE.Color('#8fffe0'))
    handle.setWeight(0.008)
    expect(handle.material.side).toBe(THREE.FrontSide)
    expect(handle.material.isMeshStandardMaterial).toBe(true)
    expect(handle.material.onBeforeCompile).toBeTypeOf('function')
    handle.material.dispose()
  })

  it('never writes depth by default so fading lines cannot ghost over each other', () => {
    // transparent + depthWrite 会让正在淡出的旧句把新句挖掉（切句残影）。
    // 深度写入只由图层对"完全不透明的当前句"逐帧打开，材质默认必须是关的。
    const handle = createLyricsMaterial('#ffffff')
    expect(handle.material.transparent).toBe(true)
    expect(handle.material.depthWrite).toBe(false)
    handle.material.dispose()
  })

  it('clamps the per-glyph cascade inputs', () => {
    const handle = createLyricsMaterial('#ffffff')
    expect(() => handle.setCascade(-1, -1, 0)).not.toThrow()
    expect(() => handle.setCascade(2, 0.5, 12)).not.toThrow()
    handle.material.dispose()
  })
})

describe('lyrics3d-mesh display tuning', () => {
  it('keeps zoom and synthetic weight inside legible bounds', () => {
    expect(LYRICS_ZOOM_MIN_RADIUS).toBe(6.4)
    expect(LYRICS_ZOOM_MAX_RADIUS).toBe(18)
    expect(LYRICS_FONT_WEIGHT).toBeGreaterThanOrEqual(0)
    expect(LYRICS_FONT_WEIGHT).toBeLessThanOrEqual(0.03)
  })
})

describe('lyrics3d-mesh word highlighting', () => {
  const words = [
    { text: '你', time: 2, duration: 0.4 },
    { text: '好', time: 2.4, duration: 0.6 },
  ] as const

  it('advances through glyphs using exact word timing', () => {
    expect(lyricGlyphProgress(words, 1.9, 2)).toBe(0)
    expect(lyricGlyphProgress(words, 2.2, 2)).toBeCloseTo(0.5)
    expect(lyricGlyphProgress(words, 2.4, 2)).toBe(1)
    expect(lyricGlyphProgress(words, 2.7, 2)).toBeCloseTo(1.5)
    expect(lyricGlyphProgress(words, 3.1, 2)).toBe(2)
  })

  it('scales word progress to the shaped glyph count', () => {
    expect(lyricGlyphProgress(words, 2.4, 4)).toBe(2)
    expect(lyricGlyphProgress(undefined, 2.4, 4)).toBe(0)
  })
})

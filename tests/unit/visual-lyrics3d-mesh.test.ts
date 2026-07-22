import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { lyricGlyphProgress } from '@renderer/visual/lyrics3d-mesh/highlight'
import { createLyricsMaterial } from '@renderer/visual/lyrics3d-mesh/material'

describe('lyrics3d-mesh static material', () => {
  it('uses a front-sided standard material without deformation modes', () => {
    const handle = createLyricsMaterial('#ffffff')
    handle.setHighlight(1.4, 1, new THREE.Color('#8fffe0'))
    expect(handle.material.side).toBe(THREE.FrontSide)
    expect(handle.material.isMeshStandardMaterial).toBe(true)
    expect(handle.material.onBeforeCompile).toBeTypeOf('function')
    handle.material.dispose()
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

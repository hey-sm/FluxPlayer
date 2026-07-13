import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_LYRICS_3D_STATE,
  Lyrics3DLayer,
  deriveLyrics3DState,
  findActiveLyricIndex,
  selectLyricWindow,
} from '@renderer/visual/lyrics3d'

const lines = [
  { time: 1, text: 'one' },
  { time: 2, text: 'two-a' },
  { time: 2, text: 'two-b', ttext: '二' },
  { time: 4, text: 'four' },
  { time: 8, text: 'eight' },
  { time: 12, text: 'twelve' },
]

describe('M4 stage lyrics pure state', () => {
  it('selects the last timestamp at or before playback position', () => {
    expect(findActiveLyricIndex(lines, 0.99)).toBe(-1)
    expect(findActiveLyricIndex(lines, 2)).toBe(2)
    expect(findActiveLyricIndex(lines, 99)).toBe(5)
    expect(findActiveLyricIndex(lines, Number.NaN)).toBe(-1)
  })

  it('builds a bounded adjacent-line window around the active line', () => {
    expect(
      selectLyricWindow(lines, 2, 2, 2).map(({ index, relativeIndex }) => [index, relativeIndex]),
    ).toEqual([
      [0, -2],
      [1, -1],
      [2, 0],
      [3, 1],
      [4, 2],
    ])
    expect(selectLyricWindow(lines, 0, 2, 2).map(({ index }) => index)).toEqual([0, 1, 2])
    expect(selectLyricWindow(lines, -1)).toEqual([])
  })

  it('clears active/window state immediately when the track changes or becomes hidden', () => {
    const active = deriveLyrics3DState(EMPTY_LYRICS_3D_STATE, {
      trackKey: 'netease:old',
      lines,
      position: 4,
      visible: true,
    })
    expect(active).toMatchObject({ trackKey: 'netease:old', activeIndex: 3, windowStart: 1, windowEnd: 5 })

    const switched = deriveLyrics3DState(active, {
      trackKey: 'qq:new',
      lines: [],
      position: 4,
      visible: true,
    })
    expect(switched).toEqual({ trackKey: 'qq:new', activeIndex: -1, windowStart: -1, windowEnd: -1 })

    expect(
      deriveLyrics3DState(active, {
        trackKey: 'netease:old',
        lines,
        position: 4,
        visible: false,
      }),
    ).toEqual({ trackKey: 'netease:old', activeIndex: -1, windowStart: -1, windowEnd: -1 })
  })
})

describe('Lyrics3DLayer node-safe lifecycle', () => {
  it('disposes every owned Three resource on track switch and interpolates independently of tick splits', () => {
    const context = {
      clearRect: vi.fn(),
      fillText: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 30 }),
      textAlign: 'center',
      textBaseline: 'middle',
      shadowBlur: 0,
      shadowColor: '',
      font: '',
      fillStyle: '',
    }
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    })

    try {
      const frame = {
        trackKey: 'netease:1',
        lines,
        position: 4,
        accentColor: '#8fffe0',
        visible: true,
      } as const
      const wholeStep = new Lyrics3DLayer()
      const splitStep = new Lyrics3DLayer()
      wholeStep.setFrame(frame)
      splitStep.setFrame(frame)

      const ownedMesh = wholeStep.group.children[0] as THREE.Mesh<
        THREE.PlaneGeometry,
        THREE.MeshBasicMaterial
      >
      const textureDispose = vi.spyOn(ownedMesh.material.map!, 'dispose')
      const geometryDispose = vi.spyOn(ownedMesh.geometry, 'dispose')
      const materialDispose = vi.spyOn(ownedMesh.material, 'dispose')

      wholeStep.update(0.1)
      splitStep.update(0.05)
      splitStep.update(0.05)
      expect(splitStep.group.children[0].position.y).toBeCloseTo(wholeStep.group.children[0].position.y, 10)
      expect((splitStep.group.children[0] as THREE.Mesh).scale.x).toBeCloseTo(
        (wholeStep.group.children[0] as THREE.Mesh).scale.x,
        10,
      )

      wholeStep.setFrame({ ...frame, trackKey: 'qq:2', lines: [] })
      expect(textureDispose).toHaveBeenCalledOnce()
      expect(geometryDispose).toHaveBeenCalledOnce()
      expect(materialDispose).toHaveBeenCalledOnce()
      expect(wholeStep.group.children).toHaveLength(0)

      wholeStep.dispose()
      splitStep.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('degrades safely without DOM and supports idempotent disposal', () => {
    const layer = new Lyrics3DLayer()
    expect(() =>
      layer.setFrame({
        trackKey: 'netease:1',
        lines,
        position: 4,
        accentColor: '#8fffe0',
        visible: true,
      }),
    ).not.toThrow()
    expect(layer.group.visible).toBe(false)
    expect(() => layer.update(1 / 60)).not.toThrow()
    expect(() => {
      layer.dispose()
      layer.dispose()
    }).not.toThrow()
  })
})

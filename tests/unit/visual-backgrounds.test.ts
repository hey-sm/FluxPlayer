import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { CinematicVistaBackground } from '@renderer/visual/backgrounds/cinematic-vista'
import { MusicBackgroundManager } from '@renderer/visual/backgrounds/manager'
import { MUSIC_BACKGROUND_DEFINITIONS, isMusicBackgroundPreset } from '@renderer/visual/backgrounds/registry'
import type {
  BackgroundPresetId,
  MusicVisualBackground,
  MusicVisualBackgroundDefinition,
} from '@renderer/visual/backgrounds/types'

const frame = {
  analyserFrame: { bass: 0.2, mid: 0.3, treble: 0.4, energy: 0.35, timestamp: 1 },
  beatPulse: 0.25,
  accentColor: '#7c8cff',
} as const

function fakeDefinition(id: BackgroundPresetId) {
  const background: MusicVisualBackground = {
    group: new THREE.Group(),
    setCoverTexture: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
  }
  const definition: MusicVisualBackgroundDefinition = { id, create: vi.fn(() => background) }
  return { definition, background }
}

describe('music background registry', () => {
  it('appends managed background ids without changing the 0..9 ABI', () => {
    expect(MUSIC_BACKGROUND_DEFINITIONS.map(({ id }) => id)).toEqual([7, 8, 9, 10])
    expect(isMusicBackgroundPreset(10)).toBe(true)
    expect(isMusicBackgroundPreset(6)).toBe(false)
    expect(isMusicBackgroundPreset(11)).toBe(false)
  })
})

describe('MusicBackgroundManager lifecycle', () => {
  it('lazily owns one background, forwards Stage frames and disposes on replacement', () => {
    const first = fakeDefinition(7)
    const second = fakeDefinition(10)
    const definitions = new Map<BackgroundPresetId, MusicVisualBackgroundDefinition>([
      [7, first.definition],
      [10, second.definition],
    ])
    const manager = new MusicBackgroundManager(definitions)
    const borrowedCover = new THREE.Texture()
    const borrowedDispose = vi.spyOn(borrowedCover, 'dispose')

    manager.setCoverTexture(borrowedCover)
    expect(first.definition.create).not.toHaveBeenCalled()
    expect(manager.group.children).toHaveLength(0)

    manager.setPreset(10)
    expect(second.definition.create).toHaveBeenCalledOnce()
    expect(second.background.setCoverTexture).toHaveBeenCalledWith(borrowedCover)
    expect(manager.activePresetId).toBe(10)
    expect(manager.group.children).toEqual([second.background.group])

    manager.update(1 / 60, frame)
    expect(second.background.update).toHaveBeenCalledWith(1 / 60, frame)
    manager.setPreset(10)
    expect(second.definition.create).toHaveBeenCalledOnce()

    manager.setPreset(7)
    expect(second.background.dispose).toHaveBeenCalledOnce()
    expect(first.definition.create).toHaveBeenCalledOnce()
    expect(manager.activePresetId).toBe(7)

    manager.dispose()
    manager.dispose()
    expect(first.background.dispose).toHaveBeenCalledOnce()
    expect(manager.group.children).toHaveLength(0)
    expect(borrowedDispose).not.toHaveBeenCalled()
  })
})

describe('CinematicVistaBackground cover ownership', () => {
  it('uses an owned gradient fallback and never disposes a borrowed Stage cover', () => {
    const background = new CinematicVistaBackground()
    const window = background.group.getObjectByName('cinematic-vista-cover-window') as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.MeshBasicMaterial
    >
    const fallback = window.material.map
    const borrowedCover = new THREE.Texture()
    const fallbackDispose = vi.spyOn(fallback!, 'dispose')
    const borrowedDispose = vi.spyOn(borrowedCover, 'dispose')

    expect(fallback?.name).toBe('cinematic-vista-fallback-cover')
    background.setCoverTexture(borrowedCover)
    expect(window.material.map).toBe(borrowedCover)
    background.setCoverTexture(null)
    expect(window.material.map).toBe(fallback)
    background.setCoverTexture(borrowedCover)

    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    background.group.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.Points
      if (renderable.geometry) geometries.add(renderable.geometry)
      const objectMaterials = Array.isArray(renderable.material)
        ? renderable.material
        : renderable.material
          ? [renderable.material]
          : []
      for (const material of objectMaterials) materials.add(material)
    })
    const geometryDisposers = [...geometries].map((geometry) => vi.spyOn(geometry, 'dispose'))
    const materialDisposers = [...materials].map((material) => vi.spyOn(material, 'dispose'))

    background.update(1 / 60, frame)
    background.dispose()
    background.dispose()

    expect(fallbackDispose).toHaveBeenCalledOnce()
    expect(borrowedDispose).not.toHaveBeenCalled()
    for (const dispose of geometryDisposers) expect(dispose).toHaveBeenCalledOnce()
    for (const dispose of materialDisposers) expect(dispose).toHaveBeenCalledOnce()
    expect(background.group.children).toHaveLength(0)
  })
})

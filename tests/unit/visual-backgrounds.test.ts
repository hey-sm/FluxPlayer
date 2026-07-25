import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  DYNAMIC_BACKGROUND_DEFINITIONS,
  DynamicBackgroundManager,
  isDynamicBackgroundEffect,
  type DynamicBackgroundEffect,
} from '@renderer/visual/backgrounds'
import { GalaxyBackground } from '@renderer/visual/backgrounds/galaxy'
import { HtmlLightBackground } from '@renderer/visual/backgrounds/html-light'
import { LightRaysBackground } from '@renderer/visual/backgrounds/light-rays'
import type { DynamicBackground, DynamicBackgroundDefinition } from '@renderer/visual/backgrounds/types'

function fakeDefinition(effect: DynamicBackgroundEffect) {
  const background: DynamicBackground = {
    group: new THREE.Group(),
    setAccentColor: vi.fn(),
    setViewport: vi.fn(),
    setPointer: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
  }
  const definition: DynamicBackgroundDefinition = {
    effect,
    create: vi.fn(() => background),
  }
  return { definition, background }
}

describe('dynamic background registry', () => {
  it('exposes Light Rays, Galaxy, and HTML Light and validates persisted values', () => {
    expect(DYNAMIC_BACKGROUND_DEFINITIONS.map(({ effect }) => effect)).toEqual([
      'light-rays',
      'galaxy',
      'html-light',
    ])
    expect(isDynamicBackgroundEffect('light-rays')).toBe(true)
    expect(isDynamicBackgroundEffect('galaxy')).toBe(true)
    expect(isDynamicBackgroundEffect('html-light')).toBe(true)
    expect(isDynamicBackgroundEffect('cinematic-vista')).toBe(false)
    expect(isDynamicBackgroundEffect(null)).toBe(false)
  })
})

describe('DynamicBackgroundManager lifecycle', () => {
  it('owns one effect, restores viewport/pointer state and disposes replacements once', () => {
    const lightRays = fakeDefinition('light-rays')
    const galaxy = fakeDefinition('galaxy')
    const manager = new DynamicBackgroundManager(
      new Map([
        ['light-rays', lightRays.definition],
        ['galaxy', galaxy.definition],
      ]),
    )

    manager.setViewport(1280, 720, 1.25)
    manager.setPointer(0.2, 0.7, true)
    manager.setAccentColor('#3b82f6')
    manager.setEffect('light-rays')
    expect(lightRays.background.setAccentColor).toHaveBeenCalledWith('#3b82f6')
    expect(lightRays.background.setViewport).toHaveBeenCalledWith(1280, 720, 1.25)
    expect(lightRays.background.setPointer).toHaveBeenCalledWith(0.2, 0.7, true)
    manager.update(1 / 60)
    expect(lightRays.background.update).toHaveBeenCalledWith(1 / 60)

    manager.setEffect('galaxy')
    expect(lightRays.background.dispose).toHaveBeenCalledOnce()
    expect(manager.activeEffectId).toBe('galaxy')
    manager.setEffect(null)
    expect(galaxy.background.dispose).toHaveBeenCalledOnce()
    expect(manager.group.children).toHaveLength(0)
    manager.dispose()
    manager.dispose()
    expect(galaxy.background.dispose).toHaveBeenCalledOnce()
  })

  it('normalizes and forwards optional pointer lifecycle events only to the active background', () => {
    const background: DynamicBackground = {
      group: new THREE.Group(),
      setAccentColor: vi.fn(),
      setViewport: vi.fn(),
      setPointer: vi.fn(),
      pointerDown: vi.fn(() => true),
      pointerMove: vi.fn(),
      pointerUp: vi.fn(),
      update: vi.fn(),
      dispose: vi.fn(),
    }
    const manager = new DynamicBackgroundManager(
      new Map([
        [
          'html-light',
          { effect: 'html-light', create: () => background } satisfies DynamicBackgroundDefinition,
        ],
      ]),
    )

    expect(manager.pointerDown({ x: 2, y: -1, button: 0, pointerId: 7 })).toBe(false)
    manager.setEffect('html-light')
    expect(manager.pointerDown({ x: 2, y: -1, button: 0, pointerId: 7 })).toBe(true)
    expect(background.pointerDown).toHaveBeenCalledWith({ x: 1, y: 0, button: 0, pointerId: 7 })
    manager.pointerMove({ x: 0.4, y: 0.6, button: -1, pointerId: 7 })
    manager.pointerUp({ x: 0.5, y: 0.7, button: 0, pointerId: 7, cancelled: true })
    expect(background.pointerMove).toHaveBeenCalledOnce()
    expect(background.pointerUp).toHaveBeenCalledOnce()
    manager.dispose()
  })
})

describe('React Bits shader ports', () => {
  it.each([
    ['light-rays', () => new LightRaysBackground()],
    ['galaxy', () => new GalaxyBackground()],
  ] as const)('%s owns one fullscreen material and disposes it idempotently', (_name, create) => {
    const background = create()
    const mesh = background.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(mesh.material, 'dispose')
    background.setViewport(800, 600, 1.25)
    background.setPointer(0.25, 0.75, true)
    background.update(1 / 60)
    background.dispose()
    background.dispose()
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
    expect(background.group.children).toHaveLength(0)
  })
})

describe('HTML Light port', () => {
  it('moves the lamp through the routed pointer lifecycle and releases all owned GPU resources once', () => {
    const background = new HtmlLightBackground()
    const lamp = background.group.getObjectByName('html-light-lamp-root')!
    const initialPosition = lamp.position.clone()
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    const textures = new Set<THREE.Texture>()
    background.group.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.Sprite
      if ('geometry' in renderable && renderable.geometry) geometries.add(renderable.geometry)
      const objectMaterials = Array.isArray(renderable.material)
        ? renderable.material
        : renderable.material
          ? [renderable.material]
          : []
      for (const material of objectMaterials) {
        materials.add(material)
        const map = (material as THREE.Material & { map?: THREE.Texture | null }).map
        if (map) textures.add(map)
      }
    })
    expect([...geometries].some((geometry) => geometry.type === 'ConeGeometry')).toBe(false)
    const geometryDisposals = [...geometries].map((geometry) => vi.spyOn(geometry, 'dispose'))
    const materialDisposals = [...materials].map((material) => vi.spyOn(material, 'dispose'))
    const textureDisposals = [...textures].map((texture) => vi.spyOn(texture, 'dispose'))

    background.setViewport(1280, 720, 1.25)
    expect(background.pointerDown({ x: 0.5, y: 0.18, button: 0, pointerId: 4 })).toBe(true)
    background.pointerMove({ x: 0.65, y: 0.27, button: -1, pointerId: 4 })
    for (let frame = 0; frame < 12; frame += 1) background.update(1 / 60)
    background.pointerUp({ x: 0.65, y: 0.27, button: 0, pointerId: 4 })
    expect(lamp.position.distanceTo(initialPosition)).toBeGreaterThan(0.01)

    background.dispose()
    background.dispose()
    for (const dispose of [...geometryDisposals, ...materialDisposals, ...textureDisposals]) {
      expect(dispose).toHaveBeenCalledOnce()
    }
    expect(background.group.children).toHaveLength(0)
  })
})

import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  DYNAMIC_BACKGROUND_DEFINITIONS,
  DYNAMIC_BACKGROUND_OPTIONS,
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
  it('exposes Light Rays, HTML Light and Galaxy and rejects removed persisted values', () => {
    expect(DYNAMIC_BACKGROUND_DEFINITIONS.map(({ effect }) => effect)).toEqual([
      'light-rays',
      'html-light',
      'galaxy',
    ])
    expect(isDynamicBackgroundEffect('light-rays')).toBe(true)
    expect(isDynamicBackgroundEffect('html-light')).toBe(true)
    expect(isDynamicBackgroundEffect('galaxy')).toBe(true)
    expect(isDynamicBackgroundEffect('cinematic-vista')).toBe(false)
    expect(isDynamicBackgroundEffect('cover-particles')).toBe(false)
    expect(isDynamicBackgroundEffect(null)).toBe(false)
  })

  it('labels every effect for the settings select', () => {
    expect(DYNAMIC_BACKGROUND_OPTIONS.map((option) => option.value)).toEqual(
      DYNAMIC_BACKGROUND_DEFINITIONS.map(({ effect }) => effect),
    )
    for (const option of DYNAMIC_BACKGROUND_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0)
      expect(option.description.length).toBeGreaterThan(0)
    }
  })
})

describe('DynamicBackgroundManager lifecycle', () => {
  it('owns one effect, restores viewport/pointer state and disposes replacements once', () => {
    const lightRays = fakeDefinition('light-rays')
    const htmlLight = fakeDefinition('html-light')
    const manager = new DynamicBackgroundManager(
      new Map([
        ['light-rays', lightRays.definition],
        ['html-light', htmlLight.definition],
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

    manager.setEffect('html-light')
    expect(lightRays.background.dispose).toHaveBeenCalledOnce()
    expect(manager.activeEffectId).toBe('html-light')
    manager.setEffect(null)
    expect(htmlLight.background.dispose).toHaveBeenCalledOnce()
    expect(manager.group.children).toHaveLength(0)
    manager.dispose()
    manager.dispose()
    expect(htmlLight.background.dispose).toHaveBeenCalledOnce()
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
  it('light-rays owns one fullscreen material and disposes it idempotently', () => {
    const create = () => new LightRaysBackground()
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

describe('Galaxy background', () => {
  it('generates a deterministic tilted spiral disc that fits the viewport', () => {
    const background = new GalaxyBackground()
    const stars = background.group.getObjectByName('galaxy-stars') as THREE.Points<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >
    const disc = background.group.getObjectByName('galaxy-disc')!
    const positions = stars.geometry.getAttribute('position')
    expect(positions.count).toBe(80_000)
    expect(stars.geometry.getAttribute('aRadius').count).toBe(80_000)
    expect(stars.geometry.getAttribute('aSize').count).toBe(80_000)
    expect(stars.geometry.getAttribute('aSeed').count).toBe(80_000)
    // Oblique tilt: neither edge-on (the disc would vanish) nor face-on.
    expect(background.group.rotation.x).toBeGreaterThan(0.15)
    expect(background.group.rotation.x).toBeLessThan(Math.PI / 2 - 0.15)

    let maxPlanarRadius = 0
    let maxThickness = 0
    for (let index = 0; index < positions.count; index += 1) {
      maxPlanarRadius = Math.max(maxPlanarRadius, Math.hypot(positions.getX(index), positions.getZ(index)))
      maxThickness = Math.max(maxThickness, Math.abs(positions.getY(index)))
    }
    expect(maxPlanarRadius).toBeGreaterThan(0.9)
    // Rim plus the widest scatter stays inside 1 + SCATTER_STRENGTH * sqrt(2).
    expect(maxPlanarRadius).toBeLessThan(1.8)
    // A lens, not a ball: vertical scatter stays a fraction of the planar scatter.
    expect(maxThickness).toBeGreaterThan(0.1)
    expect(maxThickness).toBeLessThan(maxPlanarRadius * 0.35)

    const twin = new GalaxyBackground()
    const twinStars = twin.group.getObjectByName('galaxy-stars') as THREE.Points
    expect(
      Array.from((twinStars.geometry.getAttribute('position').array as Float32Array).slice(0, 300)),
    ).toEqual(Array.from((positions.array as Float32Array).slice(0, 300)))
    twin.dispose()

    background.setViewport(1280, 720, 1.25)
    expect(background.group.scale.x).toBeGreaterThan(4)
    expect(background.group.position.y).toBeLessThan(0)
    expect(stars.material.uniforms.uSizeScale.value).toBeGreaterThan(0)
    background.setViewport(720, 1280, 1.25)
    expect(background.group.scale.x).toBeLessThan(6)

    // Tuned constants stay free to move: assert the behaviour, not the current INITIAL_SPIN value.
    const initialSpin = disc.rotation.y
    expect(initialSpin).toBeGreaterThan(0)
    background.update(1)
    expect(disc.rotation.y).toBeGreaterThan(initialSpin)
    expect(stars.material.uniforms.uTime.value).toBeCloseTo(1)
    background.dispose()
  })

  it('tints the rim with the theme accent and releases every owned resource once', () => {
    const background = new GalaxyBackground()
    const stars = background.group.getObjectByName('galaxy-stars') as THREE.Points<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >
    const glow = background.group.getObjectByName('galaxy-core-glow') as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.MeshBasicMaterial
    >
    const edge = stars.material.uniforms.uEdgeColor.value as THREE.Color
    const before = edge.clone()
    background.setAccentColor('#ff3d5a')
    // The rim leans toward the accent but keeps the reference blue as its base.
    expect(edge.r).toBeGreaterThan(before.r)
    expect(edge.b).toBeGreaterThan(edge.r)
    // The bulge stays essentially white.
    expect(glow.material.color.r).toBeGreaterThan(glow.material.color.b)
    expect(glow.material.color.g).toBeGreaterThan(0.9)

    const disposals = [
      vi.spyOn(stars.geometry, 'dispose'),
      vi.spyOn(stars.material, 'dispose'),
      vi.spyOn(glow.geometry, 'dispose'),
      vi.spyOn(glow.material, 'dispose'),
      vi.spyOn(glow.material.map!, 'dispose'),
    ]
    background.dispose()
    background.dispose()
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce()
    expect(background.group.children).toHaveLength(0)

    const idleTime = stars.material.uniforms.uTime.value
    background.update(1 / 60)
    background.setViewport(800, 600, 1)
    background.setAccentColor('#00f5d4')
    expect(stars.material.uniforms.uTime.value).toBe(idleTime)
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

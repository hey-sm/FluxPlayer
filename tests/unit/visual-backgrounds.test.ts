import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  DYNAMIC_BACKGROUND_DEFINITIONS,
  DYNAMIC_BACKGROUND_OPTIONS,
  DynamicBackgroundManager,
  isDynamicBackgroundEffect,
  type DynamicBackgroundEffect,
} from '@renderer/visual/backgrounds'
import { CausticBackground } from '@renderer/visual/backgrounds/caustic'
import { HtmlLightBackground } from '@renderer/visual/backgrounds/html-light'
import { RainBackground } from '@renderer/visual/backgrounds/rain'
import type { DynamicBackground, DynamicBackgroundDefinition } from '@renderer/visual/backgrounds/types'
import { readFileSync } from 'node:fs'

const projectFile = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')

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
  it('keeps Three.js behind the StageCanvas lazy boundary without a second stage request', () => {
    const appSource = projectFile('src/renderer/src/App.tsx')
    const stageCanvasSource = projectFile('src/renderer/src/visual/StageCanvas.tsx')

    expect(appSource).toContain("from './visual/backgrounds/dynamic'")
    expect(appSource).not.toContain("from './visual/backgrounds'")
    expect(stageCanvasSource).toContain("import { VisualStage } from './stage'")
    expect(stageCanvasSource).not.toContain("import('./stage')")
  })

  it('exposes HTML Light, Caustic and Rain and rejects removed persisted values', () => {
    expect(DYNAMIC_BACKGROUND_DEFINITIONS.map(({ effect }) => effect)).toEqual([
      'html-light',
      'caustic',
      'rain',
    ])
    expect(isDynamicBackgroundEffect('html-light')).toBe(true)
    expect(isDynamicBackgroundEffect('caustic')).toBe(true)
    expect(isDynamicBackgroundEffect('rain')).toBe(true)
    expect(isDynamicBackgroundEffect('light-rays')).toBe(false)
    expect(isDynamicBackgroundEffect('galaxy')).toBe(false)
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
    const caustic = fakeDefinition('caustic')
    const htmlLight = fakeDefinition('html-light')
    const manager = new DynamicBackgroundManager(
      new Map([
        ['caustic', caustic.definition],
        ['html-light', htmlLight.definition],
      ]),
    )

    manager.setViewport(1280, 720, 1.25)
    manager.setPointer(0.2, 0.7, true)
    manager.setAccentColor('#3b82f6')
    manager.setEffect('caustic')
    expect(caustic.background.setAccentColor).toHaveBeenCalledWith('#3b82f6')
    expect(caustic.background.setViewport).toHaveBeenCalledWith(1280, 720, 1.25)
    expect(caustic.background.setPointer).toHaveBeenCalledWith(0.2, 0.7, true)
    manager.update(1 / 60)
    expect(caustic.background.update).toHaveBeenCalledWith(1 / 60)

    manager.setEffect('html-light')
    expect(caustic.background.dispose).toHaveBeenCalledOnce()
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

describe('Caustic background', () => {
  it('owns one fullscreen material with the fixed upstream palette and disposes it idempotently', () => {
    const background = new CausticBackground()
    const mesh = background.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
    expect(mesh.name).toBe('caustic-fullscreen-quad')
    // The caustic palette is fixed to the upstream original (teal water + white
    // ridges), so there is no theme-tint uniform and setAccentColor is inert.
    expect(mesh.material.uniforms.uTint).toBeUndefined()
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(mesh.material, 'dispose')
    background.setAccentColor('#ff3d5a')
    background.setViewport(1280, 720, 1.25)
    const resolution = mesh.material.uniforms.iResolution.value as THREE.Vector2
    expect(resolution.x).toBeGreaterThan(0)
    expect(resolution.y).toBeGreaterThan(0)
    // setPointer is a deliberate no-op for the caustic composition.
    background.setPointer(0.25, 0.75, true)
    background.update(1 / 60)
    expect(mesh.material.uniforms.iTime.value).toBeCloseTo(1 / 60)
    background.dispose()
    background.dispose()
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
    expect(background.group.children).toHaveLength(0)
  })
})

describe('Rain background', () => {
  it('owns one fullscreen material, a scene texture and disposes both idempotently', () => {
    // The TextureLoader loads a real image via the DOM Image API, which does not
    // exist in the node test environment. Stub it to return an empty texture so
    // the background can be instantiated without a browser.
    const loadStub = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(new THREE.Texture())
    const background = new RainBackground()
    const mesh = background.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
    expect(mesh.name).toBe('rain-fullscreen-quad')
    expect(mesh.material.uniforms.iChannel0.value).toBeInstanceOf(THREE.Texture)
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(mesh.material, 'dispose')
    const textureDispose = vi.spyOn(mesh.material.uniforms.iChannel0.value as THREE.Texture, 'dispose')
    // The rain palette is fixed to the auto-cycling story, so setAccentColor is inert.
    background.setAccentColor('#ff3d5a')
    background.setViewport(1280, 720, 1.25)
    const resolution = mesh.material.uniforms.iResolution.value as THREE.Vector2
    expect(resolution.x).toBeGreaterThan(0)
    expect(resolution.y).toBeGreaterThan(0)
    // setPointer is a deliberate no-op — no click/scrub control.
    background.setPointer(0.25, 0.75, true)
    background.update(1 / 60)
    expect(mesh.material.uniforms.iTime.value).toBeCloseTo(1 / 60)
    background.dispose()
    background.dispose()
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
    expect(textureDispose).toHaveBeenCalledOnce()
    expect(background.group.children).toHaveLength(0)
    loadStub.mockRestore()
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

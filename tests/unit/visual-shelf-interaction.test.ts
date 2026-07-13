import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ShelfCursorController,
  ShelfDetailController,
  ShelfLayer,
  type ShelfDetailModel,
  type ShelfFrame,
  type ShelfItem,
} from '@renderer/visual/shelf'

function items(count: number, coverUrl = ''): ShelfItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    title: `Playlist ${index}`,
    subtitle: `${index} tracks`,
    coverUrl,
  }))
}

function frame(allItems: readonly ShelfItem[], centerIndex: number): ShelfFrame {
  return { items: allItems, centerIndex, visible: true, accentColor: '#55aaff' }
}

function detail(rowCount: number): ShelfDetailModel {
  return {
    id: 'detail-1',
    title: 'Large playlist',
    rows: Array.from({ length: rowCount }, (_, index) => ({
      id: `song-${index}`,
      title: `Song ${index}`,
      subtitle: `Artist ${index}`,
      playable: true,
      payload: { index },
    })),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('M4 pure shelf interaction controllers', () => {
  it('keeps cursor inertia frame-rate independent and clamps both boundaries', () => {
    const sixtyFps = new ShelfCursorController()
    const twentyFps = new ShelfCursorController()
    for (const cursor of [sixtyFps, twentyFps]) {
      cursor.setCount(120)
      cursor.setCenter(50, true)
      expect(cursor.wheel(100)).toBe(true)
    }

    for (let frameIndex = 0; frameIndex < 60; frameIndex += 1) sixtyFps.update(1 / 60)
    for (let frameIndex = 0; frameIndex < 20; frameIndex += 1) twentyFps.update(1 / 20)

    expect(sixtyFps.getState().cursor).toBeCloseTo(twentyFps.getState().cursor, 8)
    expect(sixtyFps.getState().targetIndex).toBe(51)

    const bounded = new ShelfCursorController()
    bounded.setCount(4)
    bounded.setCenter(0, true)
    expect(bounded.wheel(-100)).toBe(false)
    expect(bounded.getState().targetIndex).toBe(0)
    expect(bounded.wheel(999_999)).toBe(true)
    expect(bounded.wheel(999_999)).toBe(false)
    bounded.update(10)
    expect(bounded.getState().targetIndex).toBe(3)
    expect(bounded.getState().cursor).toBeGreaterThanOrEqual(0)
    expect(bounded.getState().cursor).toBeLessThanOrEqual(3)
  })

  it('defends pure cursor state from NaN and malformed timing input', () => {
    const cursor = new ShelfCursorController()
    cursor.setCount(Number.NaN)
    cursor.setCenter(Number.NaN, true)
    cursor.wheel(Number.NaN, Number.NaN)
    cursor.update(Number.NaN)
    expect(cursor.getState()).toEqual({
      count: 0,
      cursor: 0,
      centerIndex: 0,
      target: 0,
      targetIndex: 0,
      velocity: 0,
    })

    cursor.setCount(10)
    cursor.setCenter(4, true)
    cursor.update(Number.POSITIVE_INFINITY)
    expect(Object.values(cursor.getState()).every(Number.isFinite)).toBe(true)
  })

  it('windows 100+ detail rows to eleven and keeps selected edge rows available', () => {
    const controller = new ShelfDetailController()
    controller.open(detail(240), 120)

    expect(controller.getState().visibleRows.map(({ index }) => index)).toEqual([
      115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125,
    ])
    expect(controller.select(239)?.id).toBe('song-239')
    expect(controller.getState().visibleRows.map(({ index }) => index)).toEqual([
      229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239,
    ])
    expect(controller.wheel(100)).toBe(false)
    expect(controller.select(Number.NaN)).toBeNull()
    controller.update(Number.NaN)
    expect(Number.isFinite(controller.getState().cursor)).toBe(true)

    expect(controller.close()).toBe('detail-1')
    expect(controller.getState().open).toBe(false)
    expect(controller.getState().visibleRows).toEqual([])
  })
})

describe('M4 ShelfLayer public interaction API', () => {
  it('uses THREE.Raycaster for hover/select and floats interaction above the default lyric-back layer', () => {
    const shelf = new ShelfLayer()
    shelf.setFrame(frame(items(1), 0))
    expect(shelf.group.renderOrder).toBeLessThan(42)

    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    shelf.group.updateMatrixWorld(true)
    const cardPosition = shelf.group.children[0].getWorldPosition(new THREE.Vector3()).project(camera)

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(cardPosition.x, cardPosition.y), camera)
    const hit = shelf.raycast(raycaster)
    expect(hit?.index).toBe(0)
    expect(hit?.item.id).toBe('item-0')

    const pointerX = ((cardPosition.x + 1) / 2) * 1000
    const pointerY = ((1 - cardPosition.y) / 2) * 1000
    const hover = shelf.viewportPointer({ x: pointerX, y: pointerY, width: 1000, height: 1000 }, camera)
    expect(hover).toMatchObject({ action: 'hover', consumed: true, index: 0 })
    const baseZ = shelf.group.children[0].position.z
    shelf.update(0.1, camera)
    expect(shelf.group.children[0].position.z).toBeGreaterThan(baseZ)
    expect(shelf.group.renderOrder).toBeGreaterThan(42)

    const selected = shelf.viewportPointer(
      { x: pointerX, y: pointerY, width: 1000, height: 1000, phase: 'down' },
      camera,
    )
    expect(selected).toMatchObject({ action: 'select', consumed: true, index: 0 })
    expect(shelf.group.children[0].userData.selected).toBe(true)
    expect(shelf.getState().selectedIndex).toBe(0)
    shelf.dispose()
  })

  it('returns explicit center/detail actions while never exceeding eleven GPU cards', () => {
    const shelf = new ShelfLayer()
    shelf.setFrame(frame(items(180), 90))

    expect(shelf.wheel(100)).toMatchObject({ action: 'center', consumed: true, index: 91 })
    expect(shelf.group.children).toHaveLength(11)
    shelf.update(1 / 60)
    expect(Number.isFinite(shelf.getState().cursor)).toBe(true)
    expect(shelf.wheel(Number.NaN)).toEqual({ action: 'none', consumed: false })

    expect(shelf.openDetail(detail(140), 70)).toEqual({
      action: 'detail-open',
      consumed: true,
      detailId: 'detail-1',
    })
    expect(shelf.getDetailState().visibleRows).toHaveLength(11)
    expect(shelf.wheel(100)).toMatchObject({ action: 'detail-center', consumed: true, index: 71 })
    expect(shelf.selectDetailRow(139)).toMatchObject({
      action: 'detail-select',
      consumed: true,
      index: 139,
    })
    expect(shelf.getDetailState().visibleRows.at(-1)?.index).toBe(139)
    expect(shelf.closeDetail()).toEqual({
      action: 'detail-close',
      consumed: true,
      detailId: 'detail-1',
    })
    shelf.dispose()
  })

  it('ignores invalid viewport input and stale async covers after idempotent dispose', () => {
    class FakeImage {
      static readonly instances: FakeImage[] = []
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      private value = ''

      constructor() {
        FakeImage.instances.push(this)
      }

      get src(): string {
        return this.value
      }

      set src(value: string) {
        this.value = value
      }
    }
    vi.stubGlobal('Image', FakeImage)

    const textureDispose = vi.spyOn(THREE.Texture.prototype, 'dispose')
    const shelf = new ShelfLayer()
    shelf.setFrame(frame(items(1, 'https://invalid.test/cover.jpg'), 0))
    const camera = new THREE.PerspectiveCamera()

    expect(
      shelf.viewportPointer({ x: Number.NaN, y: 0, width: 0, height: Number.NaN }, camera),
    ).toEqual({ action: 'none', consumed: false })
    expect(FakeImage.instances).toHaveLength(1)

    shelf.dispose()
    shelf.dispose()
    expect(textureDispose).toHaveBeenCalledTimes(1)
    expect(() => FakeImage.instances[0].onload?.()).not.toThrow()
    expect(shelf.group.children).toHaveLength(0)
    expect(shelf.getState().disposed).toBe(true)
    expect(shelf.raycast(new THREE.Raycaster())).toBeNull()
  })
})

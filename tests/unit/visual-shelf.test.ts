import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { ShelfLayer, calculateShelfWindow, calculateVerticalShelfCardLayout, type ShelfFrame, type ShelfItem } from '@renderer/visual/shelf'

function items(count: number): ShelfItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    title: `Playlist ${index}`,
    subtitle: `${index} tracks`,
    coverUrl: '',
    tag: index === 50 ? 'NOW' : undefined,
    active: index === 50,
  }))
}

function frame(allItems: readonly ShelfItem[], centerIndex: number, visible = true): ShelfFrame {
  return { items: allItems, centerIndex, visible, accentColor: '#55aaff' }
}

describe('M4 windowed visual shelf', () => {
  it('calculates empty and edge-shifted radius-five windows', () => {
    expect(calculateShelfWindow(0, 0)).toEqual([])
    expect(calculateShelfWindow(100, 0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(calculateShelfWindow(100, 99)).toEqual([89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99])
    expect(calculateShelfWindow(4, 2)).toEqual([0, 1, 2, 3])
    expect(calculateShelfWindow(100, 50, 99)).toHaveLength(11)
  })

  it('places the shelf on the left and rotates neighboring cards on a vertical arc', () => {
    const center = calculateVerticalShelfCardLayout(0)
    const above = calculateVerticalShelfCardLayout(-1)
    const below = calculateVerticalShelfCardLayout(1)
    const edge = calculateVerticalShelfCardLayout(5)

    expect(center.x).toBeLessThan(-1)
    expect(above.y).toBeGreaterThan(center.y)
    expect(below.y).toBeLessThan(center.y)
    expect(above.rotationX).toBeLessThan(center.rotationX)
    expect(below.rotationX).toBeGreaterThan(center.rotationX)
    expect(edge.z).toBeLessThan(center.z)
    expect(Math.abs(edge.rotationX)).toBeGreaterThan(Math.abs(center.rotationX))
  })

  it('creates only the visible 11 cards for 100+ items and emphasizes the center card', () => {
    const shelf = new ShelfLayer()
    shelf.setFrame(frame(items(140), 70))

    expect(shelf.group.children).toHaveLength(11)
    expect(shelf.group.children.map((child) => child.userData.index)).toEqual([
      65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75,
    ])
    const center = shelf.group.children.find((child) => child.userData.isCenter)
    expect(center?.userData.itemId).toBe('item-70')
    expect(center?.scale.x).toBeGreaterThan(1)
    expect(center?.position.z).toBeGreaterThan(0)
    shelf.dispose()
  })

  it('recycles GPU resources when the window changes and disposes idempotently', () => {
    const textureDispose = vi.spyOn(THREE.Texture.prototype, 'dispose')
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose')
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    const shelf = new ShelfLayer()
    const allItems = items(120)

    shelf.setFrame(frame(allItems, 5))
    const oldMeshes = [...shelf.group.children]
    shelf.setFrame(frame(allItems, 80))

    expect(shelf.group.children).toHaveLength(11)
    expect(oldMeshes.every((mesh) => mesh.parent === null)).toBe(true)
    expect(textureDispose).toHaveBeenCalledTimes(11)
    expect(materialDispose).toHaveBeenCalledTimes(11)
    expect(geometryDispose).toHaveBeenCalledTimes(11)

    shelf.dispose()
    shelf.dispose()
    expect(textureDispose).toHaveBeenCalledTimes(22)
    expect(materialDispose).toHaveBeenCalledTimes(22)
    expect(geometryDispose).toHaveBeenCalledTimes(22)
    expect(shelf.group.children).toHaveLength(0)
    expect(shelf.group.visible).toBe(false)
  })

  it('applies visibility and active state without owning an animation clock', () => {
    const shelf = new ShelfLayer()
    const allItems = items(101)
    shelf.setFrame(frame(allItems, 50, false))
    expect(shelf.group.visible).toBe(false)

    shelf.setFrame(frame(allItems, 50, true))
    expect(shelf.group.visible).toBe(true)
    expect(shelf.group.children.find((child) => child.userData.index === 50)?.userData.active).toBe(true)

    expect(() => shelf.update(1 / 60, new THREE.PerspectiveCamera())).not.toThrow()
    shelf.setFrame(frame([], 0, true))
    expect(shelf.group.visible).toBe(false)
    expect(shelf.group.children).toHaveLength(0)
    shelf.dispose()
  })
})

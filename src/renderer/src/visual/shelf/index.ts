import * as THREE from 'three'
import {
  SHELF_VISIBLE_RADIUS,
  ShelfCursorController,
  ShelfDetailController,
  calculateShelfWindow,
  type ShelfDetailModel,
  type ShelfDetailRow,
  type ShelfDetailState,
} from './controller'

export {
  SHELF_VISIBLE_RADIUS,
  ShelfCursorController,
  ShelfDetailController,
  calculateShelfWindow,
  type ShelfCursorState,
  type ShelfDetailModel,
  type ShelfDetailRow,
  type ShelfDetailState,
  type ShelfDetailWindowRow,
} from './controller'

export interface ShelfItem {
  id: string
  title: string
  subtitle: string
  coverUrl: string
  tag?: string
  active?: boolean
}

export interface ShelfFrame {
  items: readonly ShelfItem[]
  centerIndex: number
  visible: boolean
  accentColor: string
}

export type ShelfPointerPhase = 'move' | 'down' | 'leave'

export interface ShelfViewportPointerInput {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly left?: number
  readonly top?: number
  readonly phase?: ShelfPointerPhase
}

export interface ShelfRaycastHit {
  readonly index: number
  readonly item: ShelfItem
  readonly object: THREE.Object3D
  readonly point: THREE.Vector3
  readonly uv: THREE.Vector2 | null
}

export type ShelfAction =
  | { readonly action: 'none'; readonly consumed: false }
  | {
      readonly action: 'center'
      readonly consumed: true
      readonly index: number
      readonly item: ShelfItem
    }
  | {
      readonly action: 'hover'
      readonly consumed: boolean
      readonly index: number | null
      readonly item: ShelfItem | null
      readonly hit?: ShelfRaycastHit
    }
  | {
      readonly action: 'select'
      readonly consumed: true
      readonly index: number
      readonly item: ShelfItem
      readonly hit?: ShelfRaycastHit
    }
  | {
      readonly action: 'detail-open'
      readonly consumed: true
      readonly detailId: string
    }
  | {
      readonly action: 'detail-close'
      readonly consumed: true
      readonly detailId: string
    }
  | {
      readonly action: 'detail-center'
      readonly consumed: true
      readonly index: number
      readonly row: ShelfDetailRow
    }
  | {
      readonly action: 'detail-select'
      readonly consumed: true
      readonly index: number
      readonly row: ShelfDetailRow
    }

export interface ShelfLayerState {
  readonly visible: boolean
  readonly itemCount: number
  readonly renderedCount: number
  readonly centerIndex: number
  readonly targetIndex: number
  readonly cursor: number
  readonly hoveredIndex: number | null
  readonly selectedIndex: number | null
  readonly detailOpen: boolean
  readonly disposed: boolean
}

interface ShelfCard {
  readonly canvas: HTMLCanvasElement | null
  readonly context: CanvasRenderingContext2D | null
  readonly texture: THREE.Texture
  readonly geometry: THREE.PlaneGeometry
  readonly material: THREE.MeshBasicMaterial
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  readonly item: ShelfItem
  readonly itemKey: string
  readonly index: number
  cover: CanvasImageSource | null
  disposed: boolean
  lift: number
}

const CARD_WIDTH = 2.05
const CARD_HEIGHT = 1.025
const CARD_CANVAS_WIDTH = 720
const CARD_CANVAS_HEIGHT = 360
const POSITION_EASE = 12
const LIFT_EASE = 14
const DEFAULT_GROUP_ORDER = 30
const FOREGROUND_GROUP_ORDER = 50
const NO_ACTION: ShelfAction = { action: 'none', consumed: false }

function finiteNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

export interface VerticalShelfCardLayout {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly scale: number
  readonly rotationX: number
  readonly rotationY: number
  readonly opacity: number
}

/** Camera-local cylindrical layout: the active playlist sits on the left while wheel motion rotates the stack. */
export function calculateVerticalShelfCardLayout(offset: number, lift = 0): VerticalShelfCardLayout {
  const safeOffset = finiteNumber(offset)
  const distance = Math.abs(safeOffset)
  const safeLift = clamp(finiteNumber(lift), 0, 1)
  const angle = clamp(safeOffset * 0.34, -1.42, 1.42)
  const baseScale = distance < 0.5 ? 1.12 : Math.max(0.7, 0.98 - distance * 0.055)

  return {
    x: -1.55 - Math.min(distance, SHELF_VISIBLE_RADIUS) * 0.035,
    y: -Math.sin(angle) * 3.15,
    z: 0.24 + (Math.cos(angle) - 1) * 2.55 + safeLift * 0.38,
    scale: baseScale * (1 + safeLift * 0.08),
    rotationX: angle * 0.72,
    rotationY: 0.1 + Math.min(distance, SHELF_VISIBLE_RADIUS) * 0.014,
    opacity: distance < 0.5 ? 1 : Math.max(0.46, 0.94 - distance * 0.085),
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function itemSignature(item: ShelfItem, index: number): string {
  return `${index}:${item.id}:${item.title}:${item.subtitle}:${item.coverUrl}:${item.tag ?? ''}:${item.active === true}`
}

function makeTexture(canvas: HTMLCanvasElement | null): THREE.Texture {
  if (canvas) {
    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    return texture
  }

  const texture = new THREE.DataTexture(new Uint8Array([12, 15, 22, 245]), 1, 1, THREE.RGBAFormat)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function makeCanvas(): { canvas: HTMLCanvasElement | null; context: CanvasRenderingContext2D | null } {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return { canvas: null, context: null }
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = CARD_CANVAS_WIDTH
    canvas.height = CARD_CANVAS_HEIGHT
    return { canvas, context: canvas.getContext('2d') }
  } catch {
    return { canvas: null, context: null }
  }
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
}

function normalizedAccent(value: string): string {
  return /^#[\da-f]{6}$/i.test(value) ? value : '#78a7ff'
}

function drawCard(card: ShelfCard, centerIndex: number, accentColor: string): void {
  const context = card.context
  const canvas = card.canvas
  if (!context || !canvas || card.disposed) return

  const accent = normalizedAccent(accentColor)
  const isCenter = card.index === centerIndex
  const isActive = card.item.active === true
  const isHovered = card.mesh.userData.hovered === true
  const isSelected = card.mesh.userData.selected === true
  const emphasized = isCenter || isActive || isHovered || isSelected
  const pad = 18
  const coverSize = canvas.height - pad * 2 - 8
  const coverX = pad + 6
  const coverY = pad + 4
  const textX = pad + coverSize + 32

  context.clearRect(0, 0, canvas.width, canvas.height)
  roundRect(context, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2, 32)
  context.fillStyle = 'rgba(5,8,14,0.92)'
  context.fill()
  const sheen = context.createLinearGradient(0, 0, canvas.width, canvas.height)
  sheen.addColorStop(0, 'rgba(255,255,255,0.12)')
  sheen.addColorStop(1, 'rgba(255,255,255,0.018)')
  context.fillStyle = sheen
  context.fill()
  context.strokeStyle = emphasized ? accent : 'rgba(255,255,255,0.16)'
  context.lineWidth = isSelected ? 2.8 : isCenter || isHovered ? 2.2 : 1.2
  context.stroke()

  roundRect(context, coverX, coverY, coverSize, coverSize, 26)
  context.fillStyle = '#151b27'
  context.fill()
  if (card.cover) {
    context.save()
    roundRect(context, coverX, coverY, coverSize, coverSize, 26)
    context.clip()
    try {
      context.drawImage(card.cover, coverX, coverY, coverSize, coverSize)
    } catch {
      // A decoded image may still become unavailable; the placeholder remains valid.
    }
    context.restore()
  }

  context.fillStyle = isActive ? accent : 'rgba(255,255,255,0.70)'
  context.font = '700 17px Inter, "Microsoft YaHei", sans-serif'
  context.fillText(card.item.tag ?? '', textX, pad + 36, 330)
  context.fillStyle = 'rgba(255,255,255,0.96)'
  context.font = '700 30px Inter, "Microsoft YaHei", sans-serif'
  context.fillText(card.item.title, textX, pad + 83, 350)
  context.fillStyle = 'rgba(255,255,255,0.56)'
  context.font = '400 17px Inter, "Microsoft YaHei", sans-serif'
  context.fillText(card.item.subtitle, textX, pad + 120, 350)

  context.strokeStyle = emphasized ? accent : 'rgba(255,255,255,0.28)'
  context.lineWidth = 3.5
  context.beginPath()
  context.moveTo(textX, canvas.height - pad - 22)
  context.lineTo(textX + (isCenter ? 260 : 120), canvas.height - pad - 22)
  context.stroke()
  card.texture.needsUpdate = true
}

/** Windowed PSP-style 3D playlist shelf. The owner attaches `group` and drives `update`. */
export class ShelfLayer {
  readonly group = new THREE.Group()

  private readonly cursor = new ShelfCursorController()
  private readonly detail = new ShelfDetailController()
  private readonly pointerRaycaster = new THREE.Raycaster()
  private cards: ShelfCard[] = []
  private items: readonly ShelfItem[] = []
  private accentColor = '#78a7ff'
  private frameVisible = false
  private hoveredIndex: number | null = null
  private selectedIndex: number | null = null
  private disposed = false

  constructor() {
    this.group.name = 'visual-shelf'
    this.group.renderOrder = DEFAULT_GROUP_ORDER
    this.group.visible = false
  }

  setFrame(frame: ShelfFrame): void {
    if (this.disposed) return

    const previous = this.cursor.getState()
    this.items = Array.isArray(frame.items) ? frame.items : []
    this.cursor.setCount(this.items.length)
    const requestedCenter = this.items.length
      ? clamp(Math.round(finiteNumber(frame.centerIndex)), 0, this.items.length - 1)
      : 0
    const immediate = previous.count === 0 || Math.abs(requestedCenter - previous.target) > SHELF_VISIBLE_RADIUS
    this.cursor.setCenter(requestedCenter, immediate)
    this.accentColor = normalizedAccent(frame.accentColor)
    this.frameVisible = frame.visible === true
    this.hoveredIndex = this.validIndex(this.hoveredIndex) ? this.hoveredIndex : null
    this.selectedIndex = this.validIndex(this.selectedIndex) ? this.selectedIndex : null

    this.syncCards()
    this.group.visible = this.frameVisible && this.cards.length > 0
    this.applyCardState()
    this.placeCards(1, 1)
  }

  update(deltaTime: number, camera?: THREE.Camera): void {
    if (this.disposed) return
    const delta = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0
    this.cursor.update(delta)
    this.detail.update(delta)
    this.syncCards()
    const positionEase = 1 - Math.exp(-POSITION_EASE * delta)
    const liftEase = 1 - Math.exp(-LIFT_EASE * delta)
    this.placeCards(positionEase, liftEase)

    if (camera && this.group.parent === camera) this.group.quaternion.identity()
  }

  wheel(deltaY: number, deltaMode = 0): ShelfAction {
    if (this.disposed || !this.group.visible) return NO_ACTION
    if (this.detail.getState().open) {
      if (!this.detail.wheel(deltaY, deltaMode)) return NO_ACTION
      const state = this.detail.getState()
      const row = state.detail?.rows[state.targetIndex]
      return row
        ? { action: 'detail-center', consumed: true, index: state.targetIndex, row }
        : NO_ACTION
    }
    if (!this.cursor.wheel(deltaY, deltaMode)) return NO_ACTION
    this.syncCards()
    const index = this.cursor.getState().targetIndex
    const item = this.items[index]
    return item ? { action: 'center', consumed: true, index, item } : NO_ACTION
  }

  viewportPointer(input: ShelfViewportPointerInput, camera: THREE.Camera): ShelfAction {
    if (this.disposed) return NO_ACTION
    const phase = input.phase ?? 'move'
    if (phase === 'leave') return this.setHoveredIndex(null)

    const width = finiteNumber(input.width)
    const height = finiteNumber(input.height)
    const x = finiteNumber(input.x, Number.NaN) - finiteNumber(input.left ?? 0)
    const y = finiteNumber(input.y, Number.NaN) - finiteNumber(input.top ?? 0)
    if (width <= 0 || height <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
      return this.setHoveredIndex(null)
    }
    if (x < 0 || x > width || y < 0 || y > height) return this.setHoveredIndex(null)

    camera.updateMatrixWorld(true)
    this.pointerRaycaster.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, 1 - (y / height) * 2), camera)
    const hit = this.raycast(this.pointerRaycaster)
    if (!hit) return this.setHoveredIndex(null)

    this.setHoveredIndex(hit.index, hit)
    if (phase === 'down') {
      const result = this.select(hit.index)
      return result.action === 'select' ? { ...result, hit } : result
    }
    return { action: 'hover', consumed: true, index: hit.index, item: hit.item, hit }
  }

  raycast(raycaster: THREE.Raycaster): ShelfRaycastHit | null {
    if (this.disposed || !this.group.visible || this.detail.getState().open || this.cards.length === 0) {
      return null
    }
    this.group.updateMatrixWorld(true)
    const meshes = this.cards.filter((card) => card.mesh.visible).map((card) => card.mesh)
    const intersection = raycaster.intersectObjects(meshes, false)[0]
    if (!intersection) return null
    const card = this.cards.find((candidate) => candidate.mesh === intersection.object)
    if (!card) return null
    return {
      index: card.index,
      item: card.item,
      object: intersection.object,
      point: intersection.point.clone(),
      uv: intersection.uv ? intersection.uv.clone() : null,
    }
  }

  select(index: number): ShelfAction {
    if (this.disposed || !this.validIndex(index)) return NO_ACTION
    const next = Math.round(index)
    this.selectedIndex = next
    this.cursor.setCenter(next)
    this.syncCards()
    this.applyCardState()
    this.placeCards(1, 0)
    return { action: 'select', consumed: true, index: next, item: this.items[next] }
  }

  openDetail(model: ShelfDetailModel, initialIndex = 0): ShelfAction {
    if (this.disposed || !model) return NO_ACTION
    this.detail.open(model, initialIndex)
    return { action: 'detail-open', consumed: true, detailId: model.id }
  }

  closeDetail(): ShelfAction {
    if (this.disposed || !this.detail.getState().open) return NO_ACTION
    const detailId = this.detail.close()
    return detailId === null ? NO_ACTION : { action: 'detail-close', consumed: true, detailId }
  }

  selectDetailRow(index: number): ShelfAction {
    if (this.disposed) return NO_ACTION
    const row = this.detail.select(index)
    if (!row) return NO_ACTION
    return { action: 'detail-select', consumed: true, index: Math.round(index), row }
  }

  getState(): ShelfLayerState {
    const cursor = this.cursor.getState()
    return {
      visible: !this.disposed && this.group.visible,
      itemCount: this.items.length,
      renderedCount: this.cards.length,
      centerIndex: cursor.centerIndex,
      targetIndex: cursor.targetIndex,
      cursor: cursor.cursor,
      hoveredIndex: this.hoveredIndex,
      selectedIndex: this.selectedIndex,
      detailOpen: this.detail.getState().open,
      disposed: this.disposed,
    }
  }

  getDetailState(): ShelfDetailState {
    return this.detail.getState()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.detail.close()
    this.releaseCards()
    this.items = []
    this.cursor.setCount(0)
    this.hoveredIndex = null
    this.selectedIndex = null
    this.frameVisible = false
    this.group.visible = false
    if (this.group.parent) this.group.parent.remove(this.group)
  }

  private validIndex(index: number | null): index is number {
    return index !== null && Number.isFinite(index) && Math.round(index) >= 0 && Math.round(index) < this.items.length
  }

  private setHoveredIndex(index: number | null, hit?: ShelfRaycastHit): ShelfAction {
    const next = this.validIndex(index) ? Math.round(index) : null
    const changed = next !== this.hoveredIndex
    this.hoveredIndex = next
    if (changed) {
      this.applyCardState()
      this.placeCards(1, 0)
    }
    if (next === null) {
      return changed ? { action: 'hover', consumed: false, index: null, item: null } : NO_ACTION
    }
    return { action: 'hover', consumed: true, index: next, item: this.items[next], ...(hit ? { hit } : {}) }
  }

  private syncCards(): void {
    const desired = calculateShelfWindow(this.items.length, this.cursor.getState().targetIndex)
    const oldByIndex = new Map(this.cards.map((card) => [card.index, card]))
    const nextCards: ShelfCard[] = []

    for (const index of desired) {
      const item = this.items[index]
      const old = oldByIndex.get(index)
      const key = itemSignature(item, index)
      if (old && old.itemKey === key && !old.disposed) {
        nextCards.push(old)
        oldByIndex.delete(index)
      } else {
        if (old) {
          this.disposeCard(old)
          oldByIndex.delete(index)
        }
        nextCards.push(this.buildCard(item, index, key))
      }
    }
    oldByIndex.forEach((card) => this.disposeCard(card))
    this.cards = nextCards

    this.group.clear()
    for (const card of this.cards) this.group.add(card.mesh)
    this.group.visible = this.frameVisible && this.cards.length > 0
  }

  private buildCard(item: ShelfItem, index: number, key: string): ShelfCard {
    const { canvas, context } = makeCanvas()
    const texture = makeTexture(canvas)
    const geometry = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT, 1, 1)
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = `shelf-card:${item.id}`
    mesh.userData.item = item
    mesh.userData.itemId = item.id
    mesh.userData.index = index
    const card: ShelfCard = {
      canvas,
      context,
      texture,
      geometry,
      material,
      mesh,
      item,
      itemKey: key,
      index,
      cover: null,
      disposed: false,
      lift: 0,
    }
    this.group.add(mesh)
    drawCard(card, this.cursor.getState().targetIndex, this.accentColor)
    this.loadCover(card)
    return card
  }

  private loadCover(card: ShelfCard): void {
    if (!card.item.coverUrl || typeof Image === 'undefined') return
    try {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        if (this.disposed || card.disposed) return
        card.cover = image
        drawCard(card, this.cursor.getState().targetIndex, this.accentColor)
      }
      image.onerror = () => undefined
      image.src = card.item.coverUrl
    } catch {
      // Browser image APIs can be absent or restricted in tests/SSR; the card remains usable.
    }
  }

  private applyCardState(): void {
    const centerIndex = this.cursor.getState().targetIndex
    for (const card of this.cards) {
      const hovered = card.index === this.hoveredIndex
      const selected = card.index === this.selectedIndex
      card.mesh.userData.isCenter = card.index === centerIndex
      card.mesh.userData.active = card.item.active === true
      card.mesh.userData.hovered = hovered
      card.mesh.userData.selected = selected
      drawCard(card, centerIndex, this.accentColor)
    }
  }

  private placeCards(positionEase: number, liftEase: number): void {
    const cursor = this.cursor.getState().cursor
    const safePositionEase = clamp(finiteNumber(positionEase), 0, 1)
    const safeLiftEase = clamp(finiteNumber(liftEase), 0, 1)
    let foreground = this.hoveredIndex !== null || this.selectedIndex !== null

    for (const card of this.cards) {
      const offset = card.index - cursor
      const distance = Math.abs(offset)
      const lifted = card.index === this.hoveredIndex || card.index === this.selectedIndex
      card.lift += ((lifted ? 1 : 0) - card.lift) * safeLiftEase
      if (card.lift > 0.02) foreground = true
      const layout = calculateVerticalShelfCardLayout(offset, card.lift)

      card.mesh.position.x += (layout.x - card.mesh.position.x) * safePositionEase
      card.mesh.position.y += (layout.y - card.mesh.position.y) * safePositionEase
      card.mesh.position.z += (layout.z - card.mesh.position.z) * safePositionEase
      card.mesh.scale.x += (layout.scale - card.mesh.scale.x) * safePositionEase
      card.mesh.scale.y += (layout.scale - card.mesh.scale.y) * safePositionEase
      card.mesh.scale.z = 1
      card.mesh.rotation.y += (layout.rotationY - card.mesh.rotation.y) * safePositionEase
      card.mesh.rotation.x += (layout.rotationX - card.mesh.rotation.x) * safePositionEase
      card.mesh.material.opacity += (layout.opacity - card.mesh.material.opacity) * safePositionEase
      card.mesh.visible = distance <= SHELF_VISIBLE_RADIUS + 0.55
      card.mesh.renderOrder = lifted
        ? 80 + Math.round((SHELF_VISIBLE_RADIUS + 1 - Math.min(distance, SHELF_VISIBLE_RADIUS + 1)) * 2)
        : DEFAULT_GROUP_ORDER + Math.round(SHELF_VISIBLE_RADIUS - Math.min(distance, SHELF_VISIBLE_RADIUS))
    }
    this.group.renderOrder = foreground ? FOREGROUND_GROUP_ORDER : DEFAULT_GROUP_ORDER
  }

  private disposeCard(card: ShelfCard): void {
    if (card.disposed) return
    card.disposed = true
    if (card.mesh.parent) card.mesh.parent.remove(card.mesh)
    card.material.map = null
    card.texture.dispose()
    card.material.dispose()
    card.geometry.dispose()
    if (card.canvas) {
      card.canvas.width = 1
      card.canvas.height = 1
    }
    card.cover = null
  }

  private releaseCards(): void {
    for (const card of this.cards) this.disposeCard(card)
    this.cards = []
    this.group.clear()
  }
}

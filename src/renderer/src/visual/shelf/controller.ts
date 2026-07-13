export const SHELF_VISIBLE_RADIUS = 5

const CURSOR_SPRING = 12
const WHEEL_VELOCITY = 3.2
const MAX_WHEEL_STEPS = 3
const SNAP_EPSILON = 0.0001

function finiteNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function safeCount(value: number): number {
  return Math.max(0, Math.floor(finiteNumber(value)))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

/** Returns a radius-five window shifted at either edge and capped at eleven entries. */
export function calculateShelfWindow(
  count: number,
  centerIndex: number,
  radius = SHELF_VISIBLE_RADIUS,
): readonly number[] {
  const total = safeCount(count)
  if (total === 0) return []

  const safeRadius = Math.min(
    SHELF_VISIBLE_RADIUS,
    Math.max(0, Math.floor(finiteNumber(radius))),
  )
  const capacity = Math.min(total, safeRadius * 2 + 1)
  const center = clamp(Math.round(finiteNumber(centerIndex)), 0, total - 1)
  let start = Math.max(0, center - safeRadius)
  const end = Math.min(total - 1, start + capacity - 1)
  start = Math.max(0, end - capacity + 1)

  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
}

export interface ShelfCursorState {
  readonly count: number
  readonly cursor: number
  readonly centerIndex: number
  readonly target: number
  readonly targetIndex: number
  readonly velocity: number
}

/**
 * Pure critically-damped center cursor. The owner supplies delta time; this class owns no clock.
 * Its closed-form spring is stable across frame rates and guards every numeric boundary.
 */
export class ShelfCursorController {
  private count = 0
  private cursor = 0
  private target = 0
  private velocity = 0

  setCount(count: number): void {
    this.count = safeCount(count)
    if (this.count === 0) {
      this.cursor = 0
      this.target = 0
      this.velocity = 0
      return
    }
    const maximum = this.count - 1
    this.cursor = clamp(finiteNumber(this.cursor), 0, maximum)
    this.target = clamp(finiteNumber(this.target), 0, maximum)
    if (!Number.isFinite(this.velocity)) this.velocity = 0
  }

  setCenter(index: number, immediate = false): boolean {
    if (this.count === 0 || !Number.isFinite(index)) return false
    const next = clamp(index, 0, this.count - 1)
    const changed = Math.abs(next - this.target) > SNAP_EPSILON
    this.target = next
    if (immediate) {
      this.cursor = next
      this.velocity = 0
    }
    return changed
  }

  moveBy(steps: number): boolean {
    if (this.count === 0 || !Number.isFinite(steps) || steps === 0) return false
    const previous = this.target
    const next = clamp(previous + steps, 0, this.count - 1)
    const applied = next - previous
    if (Math.abs(applied) <= SNAP_EPSILON) {
      if ((previous === 0 && steps < 0) || (previous === this.count - 1 && steps > 0)) {
        this.velocity = 0
      }
      return false
    }
    this.target = next
    this.velocity = finiteNumber(this.velocity) + applied * WHEEL_VELOCITY
    return true
  }

  wheel(deltaY: number, deltaMode = 0): boolean {
    if (!Number.isFinite(deltaY) || deltaY === 0) return false
    const mode = Number.isFinite(deltaMode) ? Math.round(deltaMode) : 0
    const rawSteps = mode === 2 ? Math.sign(deltaY) * 3 : mode === 1 ? deltaY / 3 : deltaY / 100
    return this.moveBy(clamp(rawSteps, -MAX_WHEEL_STEPS, MAX_WHEEL_STEPS))
  }

  update(deltaTime: number): boolean {
    const delta = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0
    if (delta === 0 || this.count === 0) return false

    if (!Number.isFinite(this.cursor) || !Number.isFinite(this.target) || !Number.isFinite(this.velocity)) {
      this.cursor = clamp(finiteNumber(this.target), 0, Math.max(0, this.count - 1))
      this.target = this.cursor
      this.velocity = 0
      return true
    }

    const previous = this.cursor
    const offset = this.cursor - this.target
    const springTerm = this.velocity + CURSOR_SPRING * offset
    const decay = Math.exp(-CURSOR_SPRING * delta)
    this.cursor = this.target + (offset + springTerm * delta) * decay
    this.velocity = (this.velocity - CURSOR_SPRING * springTerm * delta) * decay

    const maximum = this.count - 1
    if (this.cursor <= 0) {
      this.cursor = 0
      if (this.velocity < 0) this.velocity = 0
    } else if (this.cursor >= maximum) {
      this.cursor = maximum
      if (this.velocity > 0) this.velocity = 0
    }

    if (Math.abs(this.cursor - this.target) < SNAP_EPSILON && Math.abs(this.velocity) < SNAP_EPSILON) {
      this.cursor = this.target
      this.velocity = 0
    }
    return Math.abs(previous - this.cursor) > SNAP_EPSILON
  }

  getState(): ShelfCursorState {
    const maximum = Math.max(0, this.count - 1)
    const cursor = clamp(finiteNumber(this.cursor), 0, maximum)
    const target = clamp(finiteNumber(this.target), 0, maximum)
    return {
      count: this.count,
      cursor,
      centerIndex: this.count ? clamp(Math.round(cursor), 0, maximum) : 0,
      target,
      targetIndex: this.count ? clamp(Math.round(target), 0, maximum) : 0,
      velocity: finiteNumber(this.velocity),
    }
  }
}

export interface ShelfDetailRow {
  readonly id: string
  readonly title: string
  readonly subtitle?: string
  readonly coverUrl?: string
  readonly playable?: boolean
  readonly payload?: unknown
}

export interface ShelfDetailModel {
  readonly id: string
  readonly title: string
  readonly subtitle?: string
  readonly coverUrl?: string
  readonly rows: readonly ShelfDetailRow[]
}

export interface ShelfDetailWindowRow {
  readonly index: number
  readonly row: ShelfDetailRow
}

export interface ShelfDetailState {
  readonly open: boolean
  readonly detail: ShelfDetailModel | null
  readonly centerIndex: number
  readonly targetIndex: number
  readonly cursor: number
  readonly selectedIndex: number | null
  readonly visibleRows: readonly ShelfDetailWindowRow[]
}

/** Pure data/window controller for the future GPU detail panel. */
export class ShelfDetailController {
  private readonly cursor = new ShelfCursorController()
  private detail: ShelfDetailModel | null = null
  private opened = false
  private selectedIndex: number | null = null

  open(detail: ShelfDetailModel, initialIndex = 0): void {
    const rows = Array.isArray(detail.rows) ? detail.rows : []
    this.detail = { ...detail, rows }
    this.opened = true
    this.selectedIndex = null
    this.cursor.setCount(rows.length)
    this.cursor.setCenter(Number.isFinite(initialIndex) ? initialIndex : 0, true)
  }

  close(): string | null {
    const detailId = this.detail?.id ?? null
    this.opened = false
    this.detail = null
    this.selectedIndex = null
    this.cursor.setCount(0)
    return detailId
  }

  wheel(deltaY: number, deltaMode = 0): boolean {
    return this.opened && this.cursor.wheel(deltaY, deltaMode)
  }

  select(index: number): ShelfDetailRow | null {
    const rows = this.detail?.rows
    if (!this.opened || !rows || !Number.isFinite(index)) return null
    const next = Math.round(index)
    if (next < 0 || next >= rows.length) return null
    this.selectedIndex = next
    this.cursor.setCenter(next)
    return rows[next]
  }

  update(deltaTime: number): boolean {
    return this.opened && this.cursor.update(deltaTime)
  }

  getState(): ShelfDetailState {
    const cursor = this.cursor.getState()
    const rows = this.opened && this.detail ? this.detail.rows : []
    const indices = calculateShelfWindow(rows.length, cursor.targetIndex)
    return {
      open: this.opened,
      detail: this.opened ? this.detail : null,
      centerIndex: cursor.centerIndex,
      targetIndex: cursor.targetIndex,
      cursor: cursor.cursor,
      selectedIndex: this.opened ? this.selectedIndex : null,
      visibleRows: indices.map((index) => ({ index, row: rows[index] })),
    }
  }
}

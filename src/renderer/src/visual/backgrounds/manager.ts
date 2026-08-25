import * as THREE from 'three'
import { DEFAULT_ACCENT_COLOR } from '@/theme/classic'
import { DYNAMIC_BACKGROUND_BY_EFFECT } from './registry'
import type { DynamicBackgroundEffect } from './dynamic'
import type {
  DynamicBackground,
  DynamicBackgroundDefinition,
  DynamicBackgroundPointerInput,
} from './types'

export class DynamicBackgroundManager {
  readonly group = new THREE.Group()
  private active: DynamicBackground | null = null
  private activeEffect: DynamicBackgroundEffect | null = null
  private width = 1
  private height = 1
  private pixelRatio = 1
  private pointer = { x: 0.5, y: 0.5, active: false }
  private accentColor = DEFAULT_ACCENT_COLOR
  private container: HTMLElement | null = null
  private disposed = false

  constructor(
    private readonly definitions: ReadonlyMap<DynamicBackgroundEffect, DynamicBackgroundDefinition> =
      DYNAMIC_BACKGROUND_BY_EFFECT,
  ) {
    this.group.name = 'dynamic-background-manager'
  }

  get activeEffectId(): DynamicBackgroundEffect | null {
    return this.activeEffect
  }

  /**
   * Register the DOM element backgrounds may attach non-WebGL content behind
   * (the Stage canvas). Stored once on mount and forwarded to every active
   * background that implements {@link DynamicBackground.mount}.
   */
  mount(container: HTMLElement): void {
    if (this.disposed) return
    this.container = container
    this.active?.mount?.(container)
  }

  unmount(): void {
    if (this.disposed) return
    this.active?.unmount?.()
    this.container = null
  }

  setEffect(effect: DynamicBackgroundEffect | null): void {
    if (this.disposed) return
    if (effect === this.activeEffect && this.active) return
    this.releaseActive()
    if (!effect) return
    const definition = this.definitions.get(effect)
    if (!definition) return
    const background = definition.create()
    this.active = background
    this.activeEffect = effect
    this.group.add(background.group)
    background.setAccentColor(this.accentColor)
    background.setViewport(this.width, this.height, this.pixelRatio)
    background.setPointer(this.pointer.x, this.pointer.y, this.pointer.active)
    // Attach any non-WebGL host element behind the Stage canvas before the
    // background starts producing frames, so the first paint is not blank.
    if (this.container) background.mount?.(this.container)
  }

  setAccentColor(color: string): void {
    if (this.disposed || this.accentColor === color) return
    this.accentColor = color
    this.active?.setAccentColor(color)
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    if (this.disposed) return
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.pixelRatio = Math.max(0.5, pixelRatio)
    this.active?.setViewport(this.width, this.height, this.pixelRatio)
  }

  setPointer(x: number, y: number, active: boolean): void {
    if (this.disposed) return
    this.pointer = {
      x: THREE.MathUtils.clamp(x, 0, 1),
      y: THREE.MathUtils.clamp(y, 0, 1),
      active,
    }
    this.active?.setPointer(this.pointer.x, this.pointer.y, active)
  }

  pointerDown(input: DynamicBackgroundPointerInput): boolean {
    if (this.disposed || !this.active?.pointerDown) return false
    return this.active.pointerDown(this.normalizePointerInput(input))
  }

  pointerMove(input: DynamicBackgroundPointerInput): void {
    if (this.disposed) return
    this.active?.pointerMove?.(this.normalizePointerInput(input))
  }

  pointerUp(input: DynamicBackgroundPointerInput): void {
    if (this.disposed) return
    this.active?.pointerUp?.(this.normalizePointerInput(input))
  }

  update(deltaTime: number): void {
    if (!this.disposed) this.active?.update(deltaTime)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.releaseActive()
    this.group.clear()
  }

  private releaseActive(): void {
    if (!this.active) {
      this.activeEffect = null
      return
    }
    // Detach any non-WebGL host element before tearing down the background.
    this.active.unmount?.()
    this.group.remove(this.active.group)
    this.active.dispose()
    this.active = null
    this.activeEffect = null
  }

  private normalizePointerInput(input: DynamicBackgroundPointerInput): DynamicBackgroundPointerInput {
    return {
      ...input,
      x: THREE.MathUtils.clamp(input.x, 0, 1),
      y: THREE.MathUtils.clamp(input.y, 0, 1),
    }
  }
}

import type * as THREE from 'three'
import type { DynamicBackgroundEffect } from './dynamic'

export interface DynamicBackgroundPointerInput {
  x: number
  y: number
  button: number
  pointerId: number
  cancelled?: boolean
}

export interface DynamicBackground {
  readonly group: THREE.Group
  setAccentColor(color: string): void
  setViewport(width: number, height: number, pixelRatio: number): void
  setPointer(x: number, y: number, active: boolean): void
  pointerDown?(input: DynamicBackgroundPointerInput): boolean
  pointerMove?(input: DynamicBackgroundPointerInput): void
  pointerUp?(input: DynamicBackgroundPointerInput): void
  update(deltaTime: number): void
  dispose(): void
  /**
   * Optional DOM lifecycle. Backgrounds that render outside the shared WebGL
   * Stage (for example an embedded iframe scene) implement these to attach
   * their host element behind the Stage canvas. The manager calls `mount`
   * after constructing the background (if a container has been registered via
   * {@link DynamicBackgroundManager.mount}) and `unmount` before disposing it.
   * Pure-WebGL backgrounds leave these undefined.
   */
  mount?(container: HTMLElement): void
  unmount?(): void
}

export interface DynamicBackgroundDefinition {
  effect: DynamicBackgroundEffect
  create(): DynamicBackground
}

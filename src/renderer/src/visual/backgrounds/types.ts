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
}

export interface DynamicBackgroundDefinition {
  effect: DynamicBackgroundEffect
  create(): DynamicBackground
}

import type * as THREE from 'three'
import type { AnalyserFrame, VisualPreset } from '../bus'

export type BackgroundPresetId = Extract<VisualPreset, 7 | 8 | 9 | 10>

export interface BackgroundUpdateFrame {
  analyserFrame: Readonly<AnalyserFrame>
  beatPulse: number
  accentColor: string
}

/** A Stage-owned background. Cover textures are borrowed and must never be disposed here. */
export interface MusicVisualBackground {
  readonly group: THREE.Group
  setCoverTexture(texture: THREE.Texture | null): void
  update(deltaTime: number, frame: Readonly<BackgroundUpdateFrame>): void
  dispose(): void
}

export interface MusicVisualBackgroundDefinition {
  id: BackgroundPresetId
  create(): MusicVisualBackground
}

import type { VisualPreset } from '../bus'

export type VisualPresetName =
  | 'SILK'
  | 'TUNNEL'
  | 'ORBIT'
  | 'VOID'
  | 'VINYL'
  | 'WALLPAPER'
  | 'NEBULA'
  | 'CRYSTAL'
  | 'SKYLINE'
  | 'CINEMATIC_VISTA'

export interface VisualCameraBaseline {
  radius: number
  phi: number
  theta: number
}

/** Mechanical values from legacy triggerPresetParticleTransition()/tickPresetTransition(). */
export interface VisualPresetTransition {
  duration: number
  initialScatter: number
  initialBurst: number
  cameraPunch: number
  peakScatter: number
  peakBurst: number
  pointScaleBoost: number
}

export interface VisualPresetDefinition {
  id: VisualPreset
  name: VisualPresetName
  label: string
  description: string
  camera: VisualCameraBaseline
  transition: VisualPresetTransition
}

export const CLASSIC_PRESET_TRANSITION: Readonly<VisualPresetTransition> = Object.freeze({
  duration: 0.24,
  initialScatter: 0.12,
  initialBurst: 0.15,
  cameraPunch: 0.12,
  peakScatter: 0.16,
  peakBurst: 0.15,
  pointScaleBoost: 0.048,
})

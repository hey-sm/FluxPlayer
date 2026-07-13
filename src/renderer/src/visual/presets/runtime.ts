import type { AnalyserFrame, VisualPreset } from '../bus'
import type { VisualCameraBaseline, VisualPresetTransition } from './types'

export interface CameraCartesian {
  x: number
  y: number
  z: number
}

export interface PresetTransitionState {
  elapsed: number
  profile: Readonly<VisualPresetTransition>
}

export interface PresetTransitionFrame {
  state: PresetTransitionState | null
  scatter: number
  burst: number
  pointScale: number
}

export interface PresetAudioFrame {
  bass: number
  mid: number
  treble: number
  beat: number
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** Legacy high-numbered preset ring mapping from public/index.html:26787-26802. */
export function mapPresetAudio(
  frame: Readonly<AnalyserFrame>,
  beatPulse: number,
  preset: VisualPreset,
  intensity: number,
): PresetAudioFrame {
  if (preset < 4) {
    return { bass: frame.bass, mid: frame.mid, treble: frame.treble, beat: beatPulse }
  }

  const wallpaper = preset === 5
  const ringBass =
    frame.bass * (wallpaper ? 1.1 : 1.58) +
    beatPulse * (wallpaper ? 0.18 : 0.42) -
    frame.mid * 0.16 -
    frame.treble * 0.06
  const ringMid = frame.mid * (wallpaper ? 1.16 : 1.82) - frame.bass * 0.14 - frame.treble * 0.07
  const ringTreble = frame.treble * (wallpaper ? 1.34 : 2.28) - frame.mid * 0.1 - frame.bass * 0.05
  let bass = Math.pow(clamp01((ringBass - 0.05) / 0.58), 0.72) * intensity
  let mid = Math.pow(clamp01((ringMid - 0.045) / 0.46), 0.78) * intensity
  let treble = Math.pow(clamp01((ringTreble - 0.03) / 0.34), 0.84) * intensity
  let beat = beatPulse

  if (wallpaper) {
    bass = Math.min(bass, 0.46 * intensity)
    mid = Math.min(mid, 0.4 * intensity)
    treble = Math.min(treble, 0.36 * intensity)
    beat *= 0.34
  }
  return { bass, mid, treble, beat }
}

/** Legacy updateCamera() spherical convention: phi is elevation and theta rotates around Y. */
export function cameraCartesian(baseline: Readonly<VisualCameraBaseline>): CameraCartesian {
  const cosPhi = Math.cos(baseline.phi)
  return {
    x: baseline.radius * cosPhi * Math.sin(baseline.theta),
    y: baseline.radius * Math.sin(baseline.phi),
    z: baseline.radius * cosPhi * Math.cos(baseline.theta),
  }
}

/** Converts a legacy fixed 60 Hz lerp factor to a delta-time-independent factor. */
export function legacyEase(frameFactor: number, deltaTime: number): number {
  const factor = Math.min(1, Math.max(0, frameFactor))
  return 1 - Math.pow(1 - factor, Math.max(0, deltaTime) * 60)
}

export function beginPresetTransition(profile: Readonly<VisualPresetTransition>): PresetTransitionState {
  return { elapsed: 0, profile }
}

/** Mechanical sin-wave transition from legacy tickPresetTransition(). */
export function advancePresetTransition(
  state: PresetTransitionState,
  deltaTime: number,
  baseScatter: number,
  basePointScale: number,
): PresetTransitionFrame {
  const elapsed = state.elapsed + Math.max(0, deltaTime)
  const progress = Math.min(1, elapsed / Math.max(0.001, state.profile.duration))
  if (progress >= 1) {
    return {
      state: null,
      scatter: baseScatter,
      burst: 0,
      pointScale: basePointScale,
    }
  }
  const wave = Math.sin(progress * Math.PI)
  return {
    state: { elapsed, profile: state.profile },
    scatter: baseScatter + wave * state.profile.peakScatter,
    burst: wave * state.profile.peakBurst,
    pointScale: basePointScale * (1 + wave * state.profile.pointScaleBoost),
  }
}

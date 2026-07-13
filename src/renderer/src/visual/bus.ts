export type VisualPreset = 0 | 1 | 2 | 3 | 4 | 5

export type VisualPlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

/** Normalized analyser values consumed by the visual stage. */
export interface AnalyserFrame {
  bass: number
  mid: number
  treble: number
  energy: number
  timestamp: number
}

/** Single DIY parameter schema. Presets may override values, but uniforms never bypass this shape. */
export interface VisualParams {
  intensity: number
  depth: number
  pointScale: number
  speed: number
  twist: number
  colorBoost: number
  scatter: number
  coverResolution: number
  backgroundFade: number
  bloomStrength: number
  bloomSize: number
  tintStrength: number
  alpha: number
  particleDim: number
}

/** The only React -> visual-engine state surface. */
export interface VisualSnapshot {
  playbackState: VisualPlaybackState
  analyserFrame: AnalyserFrame
  coverUrl: string | null
  accentColor: string
  beatPulse: number
  preset: VisualPreset
  params: VisualParams
}

export const DEFAULT_ANALYSER_FRAME: Readonly<AnalyserFrame> = Object.freeze({
  bass: 0,
  mid: 0,
  treble: 0,
  energy: 0,
  timestamp: 0,
})

/** Defaults mechanically copied from legacy public/index.html uniforms 5808-5852. */
export const DEFAULT_VISUAL_PARAMS: Readonly<VisualParams> = Object.freeze({
  intensity: 0.85,
  depth: 1,
  pointScale: 1,
  speed: 1,
  twist: 0,
  colorBoost: 1.1,
  scatter: 0,
  coverResolution: 1,
  backgroundFade: 0.2,
  bloomStrength: 0.62,
  bloomSize: 2.65,
  tintStrength: 0,
  alpha: 1,
  particleDim: 1,
})

export const DEFAULT_VISUAL_SNAPSHOT: Readonly<VisualSnapshot> = Object.freeze({
  playbackState: 'idle',
  analyserFrame: DEFAULT_ANALYSER_FRAME,
  coverUrl: null,
  accentColor: '#7c8cff',
  beatPulse: 0,
  preset: 2,
  params: DEFAULT_VISUAL_PARAMS,
})

export type VisualSnapshotPatch = Omit<Partial<VisualSnapshot>, 'analyserFrame' | 'params'> & {
  analyserFrame?: Partial<AnalyserFrame>
  params?: Partial<VisualParams>
}

export type VisualSnapshotListener = (
  snapshot: Readonly<VisualSnapshot>,
  previous: Readonly<VisualSnapshot>,
) => void

function freshDefaultSnapshot(): VisualSnapshot {
  return {
    ...DEFAULT_VISUAL_SNAPSHOT,
    analyserFrame: { ...DEFAULT_ANALYSER_FRAME },
    params: { ...DEFAULT_VISUAL_PARAMS },
  }
}

/**
 * Typed single-snapshot bridge between React/player/audio workers and the Three stage.
 * Updates are synchronous so a ticker frame always observes a coherent snapshot.
 */
export class VisualBus {
  private snapshot: VisualSnapshot = freshDefaultSnapshot()
  private readonly listeners = new Set<VisualSnapshotListener>()

  getSnapshot(): Readonly<VisualSnapshot> {
    return this.snapshot
  }

  patch(patch: VisualSnapshotPatch): Readonly<VisualSnapshot> {
    const previous = this.snapshot
    this.snapshot = {
      ...previous,
      ...patch,
      analyserFrame: patch.analyserFrame
        ? { ...previous.analyserFrame, ...patch.analyserFrame }
        : previous.analyserFrame,
      params: patch.params ? { ...previous.params, ...patch.params } : previous.params,
    }
    this.listeners.forEach((listener) => {
      try {
        listener(this.snapshot, previous)
      } catch (error) {
        console.error('[VisualBus] listener failed:', error)
      }
    })
    return this.snapshot
  }

  setPlaybackState(playbackState: VisualPlaybackState): void {
    this.patch({ playbackState })
  }

  setAnalyserFrame(analyserFrame: AnalyserFrame): void {
    this.patch({ analyserFrame })
  }

  setCoverUrl(coverUrl: string | null): void {
    this.patch({ coverUrl })
  }

  setAccentColor(accentColor: string): void {
    this.patch({ accentColor })
  }

  setBeatPulse(beatPulse: number): void {
    this.patch({ beatPulse })
  }

  setPreset(preset: VisualPreset): void {
    this.patch({ preset })
  }

  setParams(params: Partial<VisualParams>): void {
    this.patch({ params })
  }

  subscribe(listener: VisualSnapshotListener): () => void {
    this.listeners.add(listener)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.listeners.delete(listener)
    }
  }

  reset(): void {
    const previous = this.snapshot
    this.snapshot = freshDefaultSnapshot()
    this.listeners.forEach((listener) => listener(this.snapshot, previous))
  }
}

export const visualBus = new VisualBus()
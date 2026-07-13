import { ticker, type TickerCallback } from '../../perf/ticker'
import { visualBus, type AnalyserFrame } from '../bus'

export const FFT_SIZE = 2048
export const MAIN_SMOOTHING = 0.58
export const BEAT_SMOOTHING = 0.1

interface FrameSink {
  setAnalyserFrame(frame: AnalyserFrame): void
  setBeatPulse?(pulse: number): void
}
interface TickSource {
  add(callback: TickerCallback): () => void
}
type AudioContextFactory = () => AudioContext
interface CapturableAudioElement extends HTMLAudioElement {
  captureStream?: () => MediaStream
  mozCaptureStream?: () => MediaStream
}
class CaptureStreamPendingError extends Error {}
interface AudioGraph {
  context: AudioContext
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  beatAnalyser: AnalyserNode
  refs: number
}
export type VisualAudioDiagnosticState =
  'idle' | 'waiting' | 'ready' | 'running' | 'suspended' | 'stopped' | 'unavailable' | 'error' | 'disposed'
export interface VisualAudioDiagnostic {
  state: VisualAudioDiagnosticState
  backend: 'capture-stream' | 'none'
  detail?: string
}

// captureStream clones media frames into a side stream. Unlike createMediaElementSource,
// it never reroutes the HTMLMediaElement's native output through WebAudio, so a suspended,
// broken, or unavailable visual graph cannot silence playback.
const graphs = new WeakMap<HTMLAudioElement, AudioGraph>()
function defaultContextFactory(): AudioContext {
  const Ctor = globalThis.AudioContext
  if (!Ctor) throw Error('Web Audio API is unavailable')
  return new Ctor()
}
function captureMethod(element: HTMLAudioElement): (() => MediaStream) | null {
  const capturable = element as CapturableAudioElement
  const method = capturable.captureStream ?? capturable.mozCaptureStream
  return typeof method === 'function' ? method.bind(element) : null
}
function errorDetail(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error || 'unknown error')
}
function acquireGraph(element: HTMLAudioElement, createContext: AudioContextFactory): AudioGraph {
  const existing = graphs.get(element)
  if (existing) {
    existing.refs++
    return existing
  }
  const capture = captureMethod(element)
  if (!capture) throw Error('HTMLMediaElement.captureStream is unavailable')
  const stream = capture()
  if (typeof stream.getAudioTracks === 'function' && stream.getAudioTracks().length === 0) {
    throw new CaptureStreamPendingError('captureStream has no audio track yet')
  }
  const context = createContext()
  try {
    const source = context.createMediaStreamSource(stream),
      analyser = context.createAnalyser(),
      beatAnalyser = context.createAnalyser()
    analyser.fftSize = FFT_SIZE
    analyser.smoothingTimeConstant = MAIN_SMOOTHING
    beatAnalyser.fftSize = FFT_SIZE
    beatAnalyser.smoothingTimeConstant = BEAT_SMOOTHING
    source.connect(analyser)
    source.connect(beatAnalyser)
    const graph = { context, source, analyser, beatAnalyser, refs: 1 }
    graphs.set(element, graph)
    return graph
  } catch (error) {
    void context.close().catch(() => undefined)
    throw error
  }
}
const clamp = (value: number): number => Math.min(1, Math.max(0, value))
const follow = (current: number, next: number, up: number, down: number, dt: number): number =>
  current + (next - current) * (1 - Math.exp(-dt / Math.max(0.001, next > current ? up : down)))

export class VisualAudioAnalyser {
  private graph: AudioGraph | null = null
  private element: HTMLAudioElement | null = null
  private frequencyData: Uint8Array<ArrayBuffer> | null = null
  private timeData: Uint8Array<ArrayBuffer> | null = null
  private beatFrequencyData: Uint8Array<ArrayBuffer> | null = null
  private beatTimeData: Uint8Array<ArrayBuffer> | null = null
  private unregisterTick: (() => void) | null = null
  private disposed = false
  private diagnostic: VisualAudioDiagnostic = { state: 'idle', backend: 'none' }
  private peaks = { bass: 0.12, mid: 0.1, treble: 0.08, energy: 0.1 }
  private envelope = { bass: 0, mid: 0, treble: 0, energy: 0 }
  private beat = {
    lowFast: 0,
    lowSlow: 0,
    bodyFast: 0,
    bodySlow: 0,
    snapFast: 0,
    snapSlow: 0,
    prevLow: 0,
    prevBody: 0,
    prevSnap: 0,
    onsetAvg: 0,
    onsetPeak: 0.032,
    pulse: 0,
  }
  constructor(
    private readonly sink: FrameSink = visualBus,
    private readonly tickSource: TickSource = ticker,
    private readonly createContext: AudioContextFactory = defaultContextFactory,
  ) {}

  attach(element: HTMLAudioElement): boolean {
    if (this.disposed || !element) return false
    if (this.element) return this.element === element && this.diagnostic.state !== 'unavailable'
    this.element = element
    if (!captureMethod(element)) {
      this.diagnostic = {
        state: 'unavailable',
        backend: 'none',
        detail: 'HTMLMediaElement.captureStream is unavailable; native playback is unchanged',
      }
      return false
    }
    element.addEventListener?.('loadedmetadata', this.handleMediaReady)
    element.addEventListener?.('playing', this.handleMediaReady)
    const ready = this.tryAcquireGraph()
    return ready || this.diagnostic.state === 'waiting'
  }
  getDiagnosticState(): VisualAudioDiagnostic {
    return { ...this.diagnostic }
  }
  start(): boolean {
    if (
      this.disposed ||
      !this.element ||
      this.diagnostic.state === 'unavailable' ||
      this.diagnostic.state === 'error'
    )
      return false
    if (this.unregisterTick) return true
    this.unregisterTick = this.tickSource.add(this.sample)
    this.updateActiveDiagnostic()
    return true
  }
  /** Only stops ticker sampling; the same instance can be started again. */
  stop(): void {
    this.unregisterTick?.()
    this.unregisterTick = null
    if (
      !this.disposed &&
      this.element &&
      this.diagnostic.state !== 'unavailable' &&
      this.diagnostic.state !== 'error'
    ) {
      this.diagnostic = { state: 'stopped', backend: 'capture-stream' }
    }
  }
  async resume(): Promise<boolean> {
    if (
      this.disposed ||
      !this.element ||
      this.diagnostic.state === 'unavailable' ||
      this.diagnostic.state === 'error'
    )
      return false
    if (!this.graph) this.tryAcquireGraph()
    const context = this.graph?.context
    if (!context || context.state === 'closed') return false
    if (context.state !== 'suspended') {
      this.updateActiveDiagnostic()
      return true
    }
    try {
      await context.resume()
      this.updateActiveDiagnostic()
      return context.state !== 'suspended'
    } catch (error) {
      this.diagnostic = { state: 'error', backend: 'capture-stream', detail: errorDetail(error) }
      return false
    }
  }
  dispose(): void {
    if (this.disposed) return
    this.stop()
    this.disposed = true
    this.element?.removeEventListener?.('loadedmetadata', this.handleMediaReady)
    this.element?.removeEventListener?.('playing', this.handleMediaReady)
    if (this.graph) this.graph.refs = Math.max(0, this.graph.refs - 1)
    this.graph = null
    this.element = null
    this.frequencyData = null
    this.timeData = null
    this.beatFrequencyData = null
    this.beatTimeData = null
    this.diagnostic = { state: 'disposed', backend: 'none' }
  }

  private handleMediaReady = (): void => {
    if (!this.graph && this.diagnostic.state === 'waiting') this.tryAcquireGraph()
  }
  private tryAcquireGraph(): boolean {
    const element = this.element
    if (this.disposed || !element) return false
    try {
      this.graph = acquireGraph(element, this.createContext)
      this.frequencyData = new Uint8Array(this.graph.analyser.frequencyBinCount)
      this.timeData = new Uint8Array(this.graph.analyser.fftSize)
      this.timeData.fill(128)
      this.beatFrequencyData = new Uint8Array(this.graph.beatAnalyser.frequencyBinCount)
      this.beatTimeData = new Uint8Array(this.graph.beatAnalyser.fftSize)
      this.beatTimeData.fill(128)
      this.updateActiveDiagnostic()
      return true
    } catch (error) {
      // captureStream can temporarily have no audio track before metadata loads.
      // Keep playback native and retry only that recoverable state on media readiness/user resume.
      this.diagnostic = {
        state: error instanceof CaptureStreamPendingError ? 'waiting' : 'error',
        backend: 'capture-stream',
        detail: errorDetail(error),
      }
      return false
    }
  }
  private updateActiveDiagnostic(): void {
    if (!this.graph) return
    const state =
      this.graph.context.state === 'suspended' ? 'suspended' : this.unregisterTick ? 'running' : 'ready'
    this.diagnostic = { state, backend: 'capture-stream' }
  }

  private sample: TickerCallback = (dt, now): void => {
    const g = this.graph,
      f = this.frequencyData,
      t = this.timeData,
      bf = this.beatFrequencyData,
      bt = this.beatTimeData
    if (this.disposed || !g || !f || !t || !bf || !bt) return
    const active = g.context.state === 'running' && !this.element?.paused
    if (!active) {
      try {
        this.decayEnvelope(dt, now)
        this.decayBeat(dt)
      } catch (error) {
        this.failAnalysis(error)
      }
      return
    }
    try {
      g.analyser.getByteFrequencyData(f)
      g.analyser.getByteTimeDomainData(t)
    } catch (error) {
      this.failAnalysis(error)
      return
    }
    const len = f.length,
      kickEnd = Math.min(len, 7),
      vocalEnd = Math.min(len, 140),
      midEnd = Math.min(len, 280)
    let bass = 0,
      mid = 0,
      treble = 0,
      rms = 0
    for (let i = 0; i < kickEnd; i++) bass += f[i] / 255
    for (let i = vocalEnd; i < midEnd; i++) mid += f[i] / 255
    for (let i = midEnd; i < len; i++) treble += f[i] / 255
    for (const value of t) {
      const v = (value - 128) / 128
      rms += v * v
    }
    bass /= Math.max(1, kickEnd)
    mid /= Math.max(1, midEnd - vocalEnd)
    treble /= Math.max(1, len - midEnd)
    rms = Math.sqrt(rms / t.length)
    this.peaks.bass = Math.max(this.peaks.bass * 0.994, bass, 0.03)
    this.peaks.mid = Math.max(this.peaks.mid * 0.993, mid, 0.026)
    this.peaks.treble = Math.max(this.peaks.treble * 0.992, treble, 0.018)
    this.peaks.energy = Math.max(this.peaks.energy * 0.995, rms, 0.03)
    const rb = clamp((bass / Math.max(0.038, this.peaks.bass * 0.66)) ** 0.78),
      rm = clamp((mid / Math.max(0.025, this.peaks.mid * 0.7)) ** 0.86),
      rt = clamp((treble / Math.max(0.02, this.peaks.treble * 0.74)) ** 0.92),
      re = clamp((rms / Math.max(0.034, this.peaks.energy * 0.68)) ** 0.82)
    this.envelope.bass = this.env(this.envelope.bass, Math.min(0.82, rb * 0.78 + re * 0.025), 0.28, 0.075)
    this.envelope.mid = this.env(this.envelope.mid, Math.min(0.68, rm * 0.64 + re * 0.025), 0.18, 0.06)
    this.envelope.treble = this.env(this.envelope.treble, Math.min(0.56, rt * 0.54), 0.18, 0.055)
    this.envelope.energy = this.env(this.envelope.energy, Math.min(0.72, re), 0.16, 0.055)
    try {
      this.sink.setAnalyserFrame({ ...this.envelope, timestamp: now })
      this.sampleBeat(Math.max(0.001, Math.min(0.08, dt || 0.016)), g, bf, bt)
    } catch (error) {
      this.failAnalysis(error)
    }
  }
  private failAnalysis(error: unknown): void {
    this.diagnostic = { state: 'error', backend: 'capture-stream', detail: errorDetail(error) }
    this.stop()
  }
  private band(data: Uint8Array<ArrayBuffer>, sampleRate: number, hz0: number, hz1: number): number {
    const binHz = sampleRate / FFT_SIZE,
      a = Math.max(1, Math.floor(hz0 / binHz)),
      b = Math.min(data.length - 1, Math.ceil(hz1 / binHz))
    let sum = 0,
      count = 0
    for (let i = a; i <= b; i++) {
      const v = data[i] / 255
      sum += v * v
      count++
    }
    return count ? Math.sqrt(sum / count) : 0
  }
  private sampleBeat(
    dt: number,
    g: AudioGraph,
    data: Uint8Array<ArrayBuffer>,
    time: Uint8Array<ArrayBuffer>,
  ): void {
    g.beatAnalyser.getByteFrequencyData(data)
    g.beatAnalyser.getByteTimeDomainData(time)
    const sr = g.context.sampleRate || 44100
    const sub = this.band(data, sr, 38, 74),
      kick = this.band(data, sr, 52, 165),
      body = this.band(data, sr, 165, 420),
      snap = this.band(data, sr, 1800, 9200),
      low = Math.min(1, kick * 0.86 + sub * 0.42),
      b = this.beat
    b.lowFast = follow(b.lowFast, low, 0.016, 0.07, dt)
    b.lowSlow = follow(b.lowSlow, low, 0.3, 0.54, dt)
    b.bodyFast = follow(b.bodyFast, body, 0.02, 0.082, dt)
    b.bodySlow = follow(b.bodySlow, body, 0.36, 0.6, dt)
    b.snapFast = follow(b.snapFast, snap, 0.012, 0.06, dt)
    b.snapSlow = follow(b.snapSlow, snap, 0.3, 0.52, dt)
    const lowFlux = Math.max(0, low - b.prevLow),
      bodyFlux = Math.max(0, body - b.prevBody),
      snapFlux = Math.max(0, snap - b.prevSnap),
      onset =
        Math.max(0, b.lowFast - b.lowSlow) * 1.62 +
        lowFlux * 1.34 +
        (Math.max(0, b.bodyFast - b.bodySlow) * 0.34 +
          bodyFlux * 0.24 +
          Math.max(0, b.snapFast - b.snapSlow) * 0.08 +
          snapFlux * 0.06) *
          0.16
    b.onsetAvg = follow(b.onsetAvg, onset, 1.1, 0.34, dt)
    b.onsetPeak = Math.max(b.onsetPeak * Math.pow(0.988, dt * 60), onset, 0.032)
    const floor = b.onsetAvg * 0.84,
      score = clamp((onset - floor) / Math.max(0.014, b.onsetPeak - floor))
    if (score > 0.56 && low > 0.12) b.pulse = Math.max(b.pulse, clamp(score * 0.68 + low * 0.32))
    b.prevLow = low
    b.prevBody = body
    b.prevSnap = snap
    this.decayBeat(dt)
  }
  private decayEnvelope(dt: number, now: number): void {
    // Legacy pause branch used *= 0.91 per 60 Hz frame; exponentiation keeps the
    // same curve independent of ticker frequency.
    const decay = Math.pow(0.91, Math.max(0, dt) * 60)
    this.envelope.bass *= decay
    this.envelope.mid *= decay
    this.envelope.treble *= decay
    this.envelope.energy *= decay
    if (
      this.envelope.bass < 0.001 &&
      this.envelope.mid < 0.001 &&
      this.envelope.treble < 0.001 &&
      this.envelope.energy < 0.001
    ) {
      this.envelope = { bass: 0, mid: 0, treble: 0, energy: 0 }
    }
    this.sink.setAnalyserFrame({ ...this.envelope, timestamp: now })
  }
  private decayBeat(dt: number): void {
    this.beat.pulse = clamp(this.beat.pulse * Math.pow(0.36, Math.max(0, dt)))
    if (this.beat.pulse < 0.001) this.beat.pulse = 0
    this.sink.setBeatPulse?.(this.beat.pulse)
  }
  private env(previous: number, next: number, attack: number, release: number): number {
    return previous + (next - previous) * (next > previous ? attack : release)
  }
}
const visualAudio = new VisualAudioAnalyser()
export const attach = (element: HTMLAudioElement): boolean => visualAudio.attach(element)
export const start = (): boolean => visualAudio.start()
export const stop = (): void => visualAudio.stop()
export const resume = (): Promise<boolean> => visualAudio.resume()
export const dispose = (): void => visualAudio.dispose()
export const getDiagnosticState = (): VisualAudioDiagnostic => visualAudio.getDiagnosticState()

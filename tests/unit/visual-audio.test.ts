import { describe, expect, it, vi } from 'vitest'
import { BEAT_SMOOTHING, FFT_SIZE, MAIN_SMOOTHING, VisualAudioAnalyser } from '@renderer/visual/audio'

function setup(state: AudioContextState = 'running') {
  const frequency = new Uint8Array(1024),
    time = new Uint8Array(2048).fill(128)
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  const source = node(),
    stream = { getAudioTracks: vi.fn(() => [{}]) } as unknown as MediaStream
  const analyser = {
    ...node(),
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 1024,
    getByteFrequencyData: vi.fn((v: Uint8Array) => v.set(frequency)),
    getByteTimeDomainData: vi.fn((v: Uint8Array) => v.set(time)),
  }
  const beatFrequency = new Uint8Array(1024),
    beatTime = new Uint8Array(2048).fill(128)
  const beat = {
    ...node(),
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 1024,
    getByteFrequencyData: vi.fn((v: Uint8Array) => v.set(beatFrequency)),
    getByteTimeDomainData: vi.fn((v: Uint8Array) => v.set(beatTime)),
  }
  const context = {
    state,
    destination: {},
    createMediaElementSource: vi.fn(() => source),
    createMediaStreamSource: vi.fn(() => source),
    createAnalyser: vi.fn().mockReturnValueOnce(analyser).mockReturnValueOnce(beat),
    createGain: vi.fn(),
    resume: vi.fn(async () => {
      context.state = 'running'
    }),
    close: vi.fn(async () => {
      context.state = 'closed'
    }),
  }
  let callback: ((dt: number, now: number) => void) | undefined
  const unregister = vi.fn(),
    ticker = {
      add: vi.fn((cb) => {
        callback = cb
        return unregister
      }),
    },
    sink = { setAnalyserFrame: vi.fn(), setBeatPulse: vi.fn() }
  return {
    frequency,
    time,
    beatFrequency,
    beatTime,
    source,
    stream,
    analyser,
    beat,
    context,
    unregister,
    ticker,
    sink,
    element: Object.assign(new EventTarget(), {
      paused: false,
      captureStream: vi.fn(() => stream),
    }) as HTMLAudioElement,
    tick: (now = 16) => callback?.(0.016, now),
  }
}
const factory = (f: ReturnType<typeof setup>) => () => f.context as unknown as AudioContext

describe('VisualAudioAnalyser', () => {
  it('globally creates one capture-stream source without touching native output', () => {
    const f = setup(),
      a = new VisualAudioAnalyser(f.sink, f.ticker, factory(f)),
      b = new VisualAudioAnalyser(f.sink, f.ticker, factory(f))
    expect(a.attach(f.element)).toBe(true)
    expect(a.attach(f.element)).toBe(true)
    expect(b.attach(f.element)).toBe(true)
    expect(f.element.captureStream).toHaveBeenCalledOnce()
    expect(f.context.createMediaStreamSource).toHaveBeenCalledOnce()
    expect(f.context.createMediaElementSource).not.toHaveBeenCalled()
    expect(f.source.connect).toHaveBeenCalledTimes(2)
    expect(f.context.createGain).not.toHaveBeenCalled()
    expect(a.attach({} as HTMLAudioElement)).toBe(false)
  })
  it('uses the legacy analyser parameters', () => {
    const f = setup()
    new VisualAudioAnalyser(f.sink, f.ticker, factory(f)).attach(f.element)
    expect([
      f.analyser.fftSize,
      f.analyser.smoothingTimeConstant,
      f.beat.fftSize,
      f.beat.smoothingTimeConstant,
    ]).toEqual([FFT_SIZE, MAIN_SMOOTHING, FFT_SIZE, BEAT_SMOOTHING])
  })
  it('normalizes bands, excludes vocal bins, envelopes, and registers one ticker', () => {
    const f = setup()
    f.frequency.fill(255)
    f.time.fill(192)
    const a = new VisualAudioAnalyser(f.sink, f.ticker, factory(f))
    a.attach(f.element)
    expect(a.start()).toBe(true)
    expect(a.start()).toBe(true)
    f.tick(123)
    expect(f.ticker.add).toHaveBeenCalledOnce()
    const frame = f.sink.setAnalyserFrame.mock.calls[0][0]
    expect(frame.timestamp).toBe(123)
    expect(frame.bass).toBeCloseTo(0.2254)
    expect(frame.mid).toBeCloseTo(0.1197)
    expect(frame.treble).toBeCloseTo(0.0972)
    expect(frame.energy).toBeCloseTo(0.1152)
  })
  it('handles suspended/disposed state and cleans up once', async () => {
    const f = setup('suspended'),
      a = new VisualAudioAnalyser(f.sink, f.ticker, factory(f))
    expect(a.start()).toBe(false)
    a.attach(f.element)
    expect(await a.resume()).toBe(true)
    a.start()
    a.dispose()
    a.dispose()
    f.tick()
    expect(f.context.resume).toHaveBeenCalledOnce()
    expect(f.unregister).toHaveBeenCalledOnce()
    expect(f.context.close).not.toHaveBeenCalled()
    expect(f.source.disconnect).not.toHaveBeenCalled()
    expect(f.sink.setAnalyserFrame).not.toHaveBeenCalled()
    expect(await a.resume()).toBe(false)
  })
  it('stops idempotently and can start again', () => {
    const f = setup(),
      a = new VisualAudioAnalyser(f.sink, f.ticker, factory(f))
    a.attach(f.element)
    a.start()
    a.stop()
    a.stop()
    expect(f.unregister).toHaveBeenCalledOnce()
    expect(a.start()).toBe(true)
    expect(f.ticker.add).toHaveBeenCalledTimes(2)
  })
  it('emits a bounded beat pulse and decays to zero while paused', () => {
    const f = setup(),
      a = new VisualAudioAnalyser(f.sink, f.ticker, factory(f))
    f.beatFrequency.fill(255, 1, 8)
    f.beatTime.fill(192)
    a.attach(f.element)
    a.start()
    f.tick()
    const peak = f.sink.setBeatPulse.mock.calls.at(-1)?.[0]
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(1)
    f.element.paused = true
    for (let i = 0; i < 500; i++) f.tick()
    expect(f.sink.setBeatPulse.mock.calls.at(-1)?.[0]).toBe(0)
  })
  it('decays analyser frame to zero while paused', () => {
    const f = setup()
    const a = new VisualAudioAnalyser(f.sink, f.ticker, factory(f))
    f.frequency.fill(255)
    f.time.fill(192)
    a.attach(f.element)
    a.start()
    f.tick(16)
    const active = f.sink.setAnalyserFrame.mock.calls.at(-1)?.[0]
    expect(active.energy).toBeGreaterThan(0)
    f.element.paused = true
    f.tick(32)
    const falling = f.sink.setAnalyserFrame.mock.calls.at(-1)?.[0]
    expect(falling.energy).toBeGreaterThan(0)
    expect(falling.energy).toBeLessThan(active.energy)
    for (let i = 0; i < 100; i++) f.tick(48 + i * 16)
    expect(f.sink.setAnalyserFrame.mock.calls.at(-1)?.[0]).toEqual({
      bass: 0,
      mid: 0,
      treble: 0,
      energy: 0,
      timestamp: 1632,
    })
  })
  it('disposing one client keeps the shared graph alive for another', () => {
    const f = setup(),
      a = new VisualAudioAnalyser(f.sink, f.ticker, factory(f)),
      b = new VisualAudioAnalyser(f.sink, f.ticker, factory(f))
    a.attach(f.element)
    b.attach(f.element)
    a.dispose()
    expect(b.start()).toBe(true)
    f.tick()
    expect(f.sink.setAnalyserFrame).toHaveBeenCalled()
    expect(f.context.close).not.toHaveBeenCalled()
    expect(f.context.createMediaStreamSource).toHaveBeenCalledOnce()
  })
  it('fails silently when captureStream is unavailable and exposes diagnostics', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const a = new VisualAudioAnalyser()
    expect(a.attach({} as HTMLAudioElement)).toBe(false)
    expect(a.start()).toBe(false)
    expect(a.getDiagnosticState()).toEqual({
      state: 'unavailable',
      backend: 'none',
      detail: 'HTMLMediaElement.captureStream is unavailable; native playback is unchanged',
    })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
  it('waits for a captured audio track and retries when media becomes ready', () => {
    const f = setup()
    vi.spyOn(f.stream, 'getAudioTracks').mockReturnValueOnce([])
    const waiting = new VisualAudioAnalyser(f.sink, f.ticker, factory(f))
    expect(waiting.attach(f.element)).toBe(true)
    expect(waiting.getDiagnosticState()).toMatchObject({ state: 'waiting', backend: 'capture-stream' })
    expect(f.context.createMediaStreamSource).not.toHaveBeenCalled()

    f.element.dispatchEvent(new Event('loadedmetadata'))
    expect(waiting.getDiagnosticState()).toEqual({ state: 'ready', backend: 'capture-stream' })
    expect(f.context.createMediaStreamSource).toHaveBeenCalledOnce()
  })
  it('keeps native playback untouched when capture analysis setup or sampling fails', () => {
    const failedSetup = setup()
    failedSetup.context.createMediaStreamSource.mockImplementationOnce(() => {
      throw Error('visual graph failed')
    })
    const broken = new VisualAudioAnalyser(failedSetup.sink, failedSetup.ticker, factory(failedSetup))
    expect(broken.attach(failedSetup.element)).toBe(false)
    expect(broken.getDiagnosticState()).toMatchObject({
      state: 'error',
      backend: 'capture-stream',
      detail: 'visual graph failed',
    })
    expect(failedSetup.context.createMediaElementSource).not.toHaveBeenCalled()

    const failedSample = setup()
    failedSample.analyser.getByteFrequencyData.mockImplementationOnce(() => {
      throw Error('analyser read failed')
    })
    const active = new VisualAudioAnalyser(failedSample.sink, failedSample.ticker, factory(failedSample))
    active.attach(failedSample.element)
    active.start()
    failedSample.tick()
    expect(active.getDiagnosticState()).toMatchObject({
      state: 'error',
      backend: 'capture-stream',
      detail: 'analyser read failed',
    })
    expect(failedSample.context.createMediaElementSource).not.toHaveBeenCalled()
  })
})

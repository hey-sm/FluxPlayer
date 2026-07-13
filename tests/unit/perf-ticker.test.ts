import { describe, expect, it, vi } from 'vitest'
import type { PerfMode, PerfState } from '@shared/perf-state'
import { Ticker, type TickerRuntime } from '@renderer/perf/ticker'

type FrameCallback = (now: number) => void

class FakeTickerRuntime implements TickerRuntime {
  private nextFrameId = 1
  private nowValue = 0
  private readonly frames = new Map<number, FrameCallback>()
  private perfListener: ((state: PerfState) => void) | null = null
  private visibilityListener: (() => void) | null = null

  readonly requestFrame = vi.fn((callback: FrameCallback) => {
    const id = this.nextFrameId++
    this.frames.set(id, callback)
    return id
  })

  readonly cancelFrame = vi.fn((id: number) => {
    this.frames.delete(id)
  })

  readonly perfCleanup = vi.fn(() => {
    this.perfListener = null
  })

  readonly visibilityCleanup = vi.fn(() => {
    this.visibilityListener = null
  })

  readonly subscribePerfState = vi.fn((callback: (state: PerfState) => void) => {
    this.perfListener = callback
    return this.perfCleanup
  })

  readonly subscribeVisibilityChange = vi.fn((callback: () => void) => {
    this.visibilityListener = callback
    return this.visibilityCleanup
  })

  now(): number {
    return this.nowValue
  }

  flushFrame(delta = 16): boolean {
    const pending = this.frames.entries().next().value as [number, FrameCallback] | undefined
    if (!pending) return false

    const [id, callback] = pending
    this.frames.delete(id)
    this.nowValue += delta
    callback(this.nowValue)
    return true
  }

  emitPerfState(state: PerfState): void {
    this.perfListener?.(state)
  }

  emitVisibilityChange(): void {
    this.visibilityListener?.()
  }

  get pendingFrames(): number {
    return this.frames.size
  }
}

function perfState(mode: PerfMode, keepAliveOverride = false): PerfState {
  return { mode, keepAliveOverride, at: 1 }
}

describe('Ticker state policy', () => {
  it('runs active and passive at the same per-frame policy; visibility is only auxiliary', () => {
    const runtime = new FakeTickerRuntime()
    const ticker = new Ticker(runtime)
    const callback = vi.fn()
    ticker.add(callback)

    expect(runtime.flushFrame()).toBe(true)
    ticker.applyPerfState(perfState('passive'))
    runtime.emitVisibilityChange()
    expect(ticker.perfMode).toBe('passive')
    expect(runtime.flushFrame()).toBe(true)

    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback.mock.calls[1]?.[0]).toBeCloseTo(0.016)
  })

  it('runs only explicit background entries while backgrounded', () => {
    const runtime = new FakeTickerRuntime()
    const ticker = new Ticker(runtime)
    const foregroundCallback = vi.fn()
    const backgroundCallback = vi.fn()
    ticker.add(foregroundCallback)
    const removeBackground = ticker.add(backgroundCallback, { runInBackground: true })

    runtime.flushFrame()
    ticker.applyPerfState(perfState('background'))
    runtime.flushFrame()

    expect(foregroundCallback).toHaveBeenCalledTimes(1)
    expect(backgroundCallback).toHaveBeenCalledTimes(2)

    removeBackground()
    expect(runtime.pendingFrames).toBe(0)
    expect(runtime.flushFrame()).toBe(false)
  })

  it('stops every callback in suspended mode by default, including background opt-ins', () => {
    const runtime = new FakeTickerRuntime()
    const ticker = new Ticker(runtime)
    const foregroundCallback = vi.fn()
    const backgroundCallback = vi.fn()
    ticker.add(foregroundCallback)
    ticker.add(backgroundCallback, { runInBackground: true })

    runtime.flushFrame()
    ticker.applyPerfState(perfState('suspended'))

    expect(runtime.pendingFrames).toBe(0)
    expect(runtime.flushFrame()).toBe(false)
    expect(foregroundCallback).toHaveBeenCalledTimes(1)
    expect(backgroundCallback).toHaveBeenCalledTimes(1)
  })

  it('honors the explicit shared keep-alive override in reduced modes', () => {
    const runtime = new FakeTickerRuntime()
    const ticker = new Ticker(runtime)
    const callback = vi.fn()
    ticker.add(callback)

    ticker.applyPerfState(perfState('suspended', true))
    expect(runtime.flushFrame()).toBe(true)
    expect(callback).toHaveBeenCalledTimes(1)

    ticker.applyPerfState(perfState('suspended', false))
    expect(runtime.pendingFrames).toBe(0)
  })

  it.each<PerfMode>(['background', 'suspended'])(
    'warms up one frame before callbacks resume from %s',
    (reducedMode) => {
      const runtime = new FakeTickerRuntime()
      const ticker = new Ticker(runtime)
      const callback = vi.fn()
      ticker.add(callback)
      runtime.flushFrame()
      expect(callback).toHaveBeenCalledTimes(1)

      ticker.applyPerfState(perfState(reducedMode))
      ticker.applyPerfState(perfState('active'))

      expect(runtime.flushFrame()).toBe(true)
      expect(callback).toHaveBeenCalledTimes(1)
      expect(runtime.pendingFrames).toBe(1)

      expect(runtime.flushFrame()).toBe(true)
      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback.mock.calls[1]?.[0]).toBeCloseTo(0.016)
    },
  )
})

describe('Ticker cleanup', () => {
  it('supports idempotent unregister/listener cleanup and destroy', () => {
    const runtime = new FakeTickerRuntime()
    const ticker = new Ticker(runtime)
    const callback = vi.fn()
    const listener = vi.fn()
    const removeCallback = ticker.add(callback)
    const removeListener = ticker.onPerfState(listener)

    runtime.emitPerfState(perfState('passive'))
    expect(listener).toHaveBeenCalledTimes(1)
    removeListener()
    removeListener()
    runtime.emitPerfState(perfState('active'))
    expect(listener).toHaveBeenCalledTimes(1)

    removeCallback()
    removeCallback()
    expect(runtime.pendingFrames).toBe(0)

    ticker.destroy()
    ticker.destroy()
    expect(runtime.perfCleanup).toHaveBeenCalledTimes(1)
    expect(runtime.visibilityCleanup).toHaveBeenCalledTimes(1)

    ticker.add(callback)
    ticker.applyPerfState(perfState('active'))
    runtime.emitVisibilityChange()
    expect(runtime.pendingFrames).toBe(0)
  })
})

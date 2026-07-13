import type { PerfMode, PerfState } from '@shared/perf-state'

export type TickerCallback = (dt: number, now: number) => void

interface TickerEntry {
  id: number
  callback: TickerCallback
  /** background 时仅该类回调继续；suspended 默认仍全部停止。 */
  runInBackground: boolean
}

export interface TickerRuntime {
  now(): number
  requestFrame?: (callback: (now: number) => void) => number
  cancelFrame?: (id: number) => void
  subscribePerfState?: (callback: (state: PerfState) => void) => () => void
  subscribeVisibilityChange?: (callback: () => void) => () => void
}

function createDefaultTickerRuntime(): TickerRuntime {
  const browserWindow = typeof window === 'undefined' ? undefined : window
  const browserDocument = typeof document === 'undefined' ? undefined : document
  const desktopBridge = browserWindow?.fluxDesktop

  return {
    now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
    requestFrame:
      browserWindow && typeof browserWindow.requestAnimationFrame === 'function'
        ? (callback) => browserWindow.requestAnimationFrame(callback)
        : undefined,
    cancelFrame:
      browserWindow && typeof browserWindow.cancelAnimationFrame === 'function'
        ? (id) => browserWindow.cancelAnimationFrame(id)
        : undefined,
    subscribePerfState: desktopBridge ? (callback) => desktopBridge.onPerfState(callback) : undefined,
    subscribeVisibilityChange: browserDocument
      ? (callback) => {
          browserDocument.addEventListener('visibilitychange', callback)
          return () => browserDocument.removeEventListener('visibilitychange', callback)
        }
      : undefined,
  }
}

function isReducedMode(mode: PerfMode): boolean {
  return mode === 'background' || mode === 'suspended'
}

/**
 * 全局唯一 RAF 注册表。所有视觉循环统一受 PerfState 约束；浏览器 visibilitychange
 * 只用于重新 evaluate，状态仍以主进程广播为准，绝不把可见失焦自行降成 background。
 */
export class Ticker {
  private readonly entries = new Map<number, TickerEntry>()
  private readonly listeners = new Set<(state: PerfState) => void>()
  private readonly cleanupTasks: Array<() => void> = []
  private readonly runtime: TickerRuntime
  private nextId = 1
  private rafId: number | null = null
  private lastTime = 0
  private mode: PerfMode = 'active'
  private keepAliveOverride = false
  private warmUpPending = false
  private destroyed = false

  constructor(runtime: TickerRuntime = createDefaultTickerRuntime()) {
    this.runtime = runtime

    const unsubscribePerf = runtime.subscribePerfState?.((state) => this.applyPerfState(state))
    if (unsubscribePerf) this.cleanupTasks.push(unsubscribePerf)

    const unsubscribeVisibility = runtime.subscribeVisibilityChange?.(() => this.evaluate())
    if (unsubscribeVisibility) this.cleanupTasks.push(unsubscribeVisibility)
  }

  get perfMode(): PerfMode {
    return this.mode
  }

  applyPerfState(state: PerfState): void {
    if (this.destroyed) return

    const nextMode = state.mode
    const nextKeepAlive = Boolean(state.keepAliveOverride)
    const modeChanged = nextMode !== this.mode
    const keepAliveChanged = nextKeepAlive !== this.keepAliveOverride
    if (!modeChanged && !keepAliveChanged) {
      this.evaluate()
      return
    }

    const resumesFromReducedMode =
      modeChanged &&
      isReducedMode(this.mode) &&
      !this.keepAliveOverride &&
      !isReducedMode(nextMode) &&
      this.entries.size > 0

    this.mode = nextMode
    this.keepAliveOverride = nextKeepAlive

    if (resumesFromReducedMode) this.warmUpPending = true
    if (isReducedMode(nextMode) && !nextKeepAlive) this.warmUpPending = false

    this.listeners.forEach((listener) => listener(state))
    this.evaluate()
  }

  onPerfState(listener: (state: PerfState) => void): () => void {
    if (this.destroyed) return () => undefined

    this.listeners.add(listener)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.listeners.delete(listener)
    }
  }

  add(callback: TickerCallback, options: { runInBackground?: boolean } = {}): () => void {
    if (this.destroyed) return () => undefined

    const id = this.nextId++
    this.entries.set(id, {
      id,
      callback,
      runInBackground: Boolean(options.runInBackground),
    })
    this.evaluate()

    let registered = true
    return () => {
      if (!registered) return
      registered = false
      this.entries.delete(id)
      this.evaluate()
    }
  }

  /** 可重复调用，并清理 bridge/document 监听与未执行 RAF。 */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true

    this.cancelScheduledFrame()
    this.entries.clear()
    this.listeners.clear()
    this.warmUpPending = false

    for (const cleanup of this.cleanupTasks.splice(0)) {
      try {
        cleanup()
      } catch (error) {
        console.error('[Ticker] cleanup failed:', error)
      }
    }
  }

  private get shouldRun(): boolean {
    if (this.destroyed || !this.entries.size) return false
    if (this.keepAliveOverride) return true
    if (this.mode === 'suspended') return false
    if (this.mode === 'background') {
      for (const entry of this.entries.values()) {
        if (entry.runInBackground) return true
      }
      return false
    }
    return true
  }

  private shouldInvoke(entry: TickerEntry): boolean {
    if (this.keepAliveOverride) return true
    if (this.mode === 'suspended') return false
    if (this.mode === 'background') return entry.runInBackground
    return true
  }

  private evaluate(): void {
    if (this.destroyed) return

    const wanted = this.shouldRun
    if (!wanted) {
      this.cancelScheduledFrame()
      if (!this.entries.size) this.warmUpPending = false
      return
    }

    if (this.rafId !== null || !this.runtime.requestFrame) return
    this.lastTime = this.runtime.now()
    this.rafId = this.runtime.requestFrame(this.frame)
  }

  private cancelScheduledFrame(): void {
    if (this.rafId === null) return
    this.runtime.cancelFrame?.(this.rafId)
    this.rafId = null
  }

  private scheduleNextFrame(): void {
    if (!this.shouldRun || this.rafId !== null || !this.runtime.requestFrame) return
    this.rafId = this.runtime.requestFrame(this.frame)
  }

  private frame = (now: number): void => {
    this.rafId = null
    if (this.destroyed || !this.shouldRun) return

    if (this.warmUpPending) {
      this.warmUpPending = false
      this.lastTime = now
      this.scheduleNextFrame()
      return
    }

    const dt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000))
    this.lastTime = now

    this.entries.forEach((entry) => {
      if (!this.shouldInvoke(entry)) return
      try {
        entry.callback(dt, now)
      } catch (error) {
        console.error('[Ticker] callback failed:', error)
      }
    })

    this.scheduleNextFrame()
  }
}

export const ticker = new Ticker()

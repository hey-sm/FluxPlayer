import { IPC } from '@shared/ipc-contract'
import {
  derivePerfMode,
  shouldEnableBackgroundThrottling,
  type PerfMode,
  type PerfState,
} from '@shared/perf-state'

export interface PerfGovernorWebContents {
  isDestroyed?(): boolean
  setBackgroundThrottling(allowed: boolean): void
  send(channel: string, state: PerfState): void
}

/** PerformanceGovernor 只依赖这些 BrowserWindow 能力，便于用轻量 fake 做单测。 */
export interface PerfGovernorWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  isFocused(): boolean
  webContents: PerfGovernorWebContents
}

export interface PerfGovernorOptions {
  isDevelopment?: boolean
  now?: () => number
  log?: (message: string) => void
}

function isDevelopmentProcess(): boolean {
  return process.env.NODE_ENV === 'development' || Boolean(process.env.ELECTRON_RENDERER_URL)
}

/**
 * 主进程性能状态的唯一事实源。
 * 窗口事件只需调用 evaluate；本类负责去重、动态 Chromium 节流和 IPC 广播。
 */
export class PerfGovernor {
  private mode: PerfMode | null = null
  private keepAliveOverride = false
  private changedAt: number
  private win: PerfGovernorWindow | null = null
  private appliedBackgroundThrottling: boolean | null = null
  private readonly isDevelopment: boolean
  private readonly now: () => number
  private readonly log: (message: string) => void

  constructor(options: PerfGovernorOptions = {}) {
    this.isDevelopment = options.isDevelopment ?? isDevelopmentProcess()
    this.now = options.now ?? Date.now
    this.log = options.log ?? console.info
    this.changedAt = this.now()
  }

  attach(win: PerfGovernorWindow): void {
    this.win = win
    this.mode = null
    this.appliedBackgroundThrottling = null
    this.evaluate()
  }

  setKeepAliveOverride(value: boolean): void {
    const next = Boolean(value)
    if (next === this.keepAliveOverride) return

    this.keepAliveOverride = next
    this.changedAt = this.now()
    this.broadcast()
  }

  get state(): PerfState {
    return {
      mode: this.mode ?? 'active',
      keepAliveOverride: this.keepAliveOverride,
      at: this.changedAt,
    }
  }

  /** 由窗口 minimize/restore/show/hide/focus/blur 等状态回调触发。 */
  evaluate(): void {
    const win = this.getLiveWindow()
    if (!win) return

    const next = derivePerfMode({
      isMinimized: win.isMinimized(),
      isVisible: win.isVisible(),
      isFocused: win.isFocused(),
    })
    this.applyBackgroundThrottling(win.webContents, shouldEnableBackgroundThrottling(next))

    const previous = this.mode
    if (next === previous) return

    this.mode = next
    this.changedAt = this.now()
    this.broadcast()

    if (this.isDevelopment && previous !== null) {
      this.log(`[PerfGovernor] ${previous} -> ${next}`)
    }
  }

  /** 可重复调用；之后到达的窗口事件会被安全忽略。 */
  destroy(): void {
    this.win = null
    this.appliedBackgroundThrottling = null
  }

  private getLiveWindow(): PerfGovernorWindow | null {
    const win = this.win
    if (!win || win.isDestroyed()) return null
    if (win.webContents.isDestroyed?.()) return null
    return win
  }

  private applyBackgroundThrottling(webContents: PerfGovernorWebContents, allowed: boolean): void {
    if (this.appliedBackgroundThrottling === allowed) return
    webContents.setBackgroundThrottling(allowed)
    this.appliedBackgroundThrottling = allowed
  }

  private broadcast(): void {
    const win = this.getLiveWindow()
    if (!win) return
    win.webContents.send(IPC.perfStateChanged, this.state)
  }
}

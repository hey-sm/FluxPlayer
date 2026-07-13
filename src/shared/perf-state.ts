/**
 * 性能状态机的共享类型。
 *
 * - active     前台可见：全量渲染
 * - passive    可见但失焦：保持全帧率（铁律：可见失焦不降帧）
 * - background 隐藏/被完全遮挡：仅保留显式后台任务
 * - suspended  最小化：默认停掉一切视觉开销，只保留音频播放
 */
export type PerfMode = 'active' | 'passive' | 'background' | 'suspended'

export interface PerfState {
  mode: PerfMode
  /** 用户 override：开启后 background/suspended 不降级视觉（直播场景） */
  keepAliveOverride: boolean
  at: number
}

export interface PerfWindowSignals {
  isMinimized: boolean
  isVisible: boolean
  isFocused: boolean
}

/**
 * 窗口信号的纯函数合成。优先级不可交换：最小化 > 不可见 > 可见失焦 > 可见聚焦。
 */
export function derivePerfMode(signals: PerfWindowSignals): PerfMode {
  if (signals.isMinimized) return 'suspended'
  if (!signals.isVisible) return 'background'
  if (!signals.isFocused) return 'passive'
  return 'active'
}

/** active/passive 必须关闭 Chromium 后台节流；其余状态显式开启。 */
export function shouldEnableBackgroundThrottling(mode: PerfMode): boolean {
  return mode === 'background' || mode === 'suspended'
}

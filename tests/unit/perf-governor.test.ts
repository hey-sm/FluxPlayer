import { describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/ipc-contract'
import { PerfGovernor, type PerfGovernorWindow } from '../../src/main/perf-governor'

interface MutableWindowState {
  minimized: boolean
  visible: boolean
  focused: boolean
  destroyed: boolean
  webContentsDestroyed: boolean
}

function createFakeWindow(initial: Partial<MutableWindowState> = {}) {
  const windowState: MutableWindowState = {
    minimized: false,
    visible: true,
    focused: true,
    destroyed: false,
    webContentsDestroyed: false,
    ...initial,
  }
  const setBackgroundThrottling = vi.fn()
  const send = vi.fn()
  const win: PerfGovernorWindow = {
    isDestroyed: () => windowState.destroyed,
    isMinimized: () => windowState.minimized,
    isVisible: () => windowState.visible,
    isFocused: () => windowState.focused,
    webContents: {
      isDestroyed: () => windowState.webContentsDestroyed,
      setBackgroundThrottling,
      send,
    },
  }

  return { windowState, win, setBackgroundThrottling, send }
}

describe('PerfGovernor', () => {
  it('broadcasts the attached state and switches throttling only across policy boundaries', () => {
    const fake = createFakeWindow()
    const governor = new PerfGovernor({ isDevelopment: false })

    governor.attach(fake.win)
    expect(fake.setBackgroundThrottling).toHaveBeenCalledTimes(1)
    expect(fake.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
    expect(fake.send).toHaveBeenCalledWith(
      IPC.perfStateChanged,
      expect.objectContaining({ mode: 'active', keepAliveOverride: false }),
    )

    fake.windowState.focused = false
    governor.evaluate()
    expect(governor.state.mode).toBe('passive')
    expect(fake.setBackgroundThrottling).toHaveBeenCalledTimes(1)

    fake.windowState.visible = false
    governor.evaluate()
    expect(governor.state.mode).toBe('background')
    expect(fake.setBackgroundThrottling).toHaveBeenCalledTimes(2)
    expect(fake.setBackgroundThrottling).toHaveBeenLastCalledWith(true)

    fake.windowState.minimized = true
    governor.evaluate()
    expect(governor.state.mode).toBe('suspended')
    expect(fake.setBackgroundThrottling).toHaveBeenCalledTimes(2)

    fake.windowState.minimized = false
    fake.windowState.visible = true
    fake.windowState.focused = true
    governor.evaluate()
    expect(governor.state.mode).toBe('active')
    expect(fake.setBackgroundThrottling).toHaveBeenCalledTimes(3)
    expect(fake.setBackgroundThrottling).toHaveBeenLastCalledWith(false)

    expect(fake.send.mock.calls.map(([, state]) => state.mode)).toEqual([
      'active',
      'passive',
      'background',
      'suspended',
      'active',
    ])
  })

  it('does not jitter on duplicate evaluate or an unchanged keep-alive value', () => {
    const fake = createFakeWindow({ visible: false })
    const governor = new PerfGovernor({ isDevelopment: false })

    governor.attach(fake.win)
    governor.evaluate()
    governor.evaluate()
    governor.setKeepAliveOverride(false)

    expect(fake.setBackgroundThrottling).toHaveBeenCalledTimes(1)
    expect(fake.setBackgroundThrottling).toHaveBeenCalledWith(true)
    expect(fake.send).toHaveBeenCalledTimes(1)
  })

  it('broadcasts each real keep-alive change without changing the mode policy', () => {
    let time = 100
    const fake = createFakeWindow({ visible: false })
    const governor = new PerfGovernor({ isDevelopment: false, now: () => ++time })
    governor.attach(fake.win)
    const attachedAt = governor.state.at

    governor.setKeepAliveOverride(true)
    governor.setKeepAliveOverride(true)
    expect(governor.state).toMatchObject({ mode: 'background', keepAliveOverride: true })
    expect(governor.state.at).toBeGreaterThan(attachedAt)

    governor.setKeepAliveOverride(false)
    expect(fake.send).toHaveBeenCalledTimes(3)
    expect(fake.setBackgroundThrottling).toHaveBeenCalledTimes(1)
    expect(fake.send.mock.calls.map(([, state]) => state.keepAliveOverride)).toEqual([false, true, false])
  })

  it('is safe when the window, webContents, or governor is destroyed', () => {
    const fake = createFakeWindow()
    const governor = new PerfGovernor({ isDevelopment: false })
    governor.attach(fake.win)

    fake.windowState.webContentsDestroyed = true
    fake.windowState.visible = false
    expect(() => governor.evaluate()).not.toThrow()
    expect(() => governor.setKeepAliveOverride(true)).not.toThrow()

    fake.windowState.webContentsDestroyed = false
    fake.windowState.destroyed = true
    expect(() => governor.evaluate()).not.toThrow()

    expect(() => {
      governor.destroy()
      governor.destroy()
      governor.evaluate()
      governor.setKeepAliveOverride(false)
    }).not.toThrow()
    expect(fake.send).toHaveBeenCalledTimes(1)
  })

  it('writes one readable development log per real mode migration', () => {
    const fake = createFakeWindow()
    const log = vi.fn()
    const governor = new PerfGovernor({ isDevelopment: true, log })
    governor.attach(fake.win)
    expect(log).not.toHaveBeenCalled()

    fake.windowState.focused = false
    governor.evaluate()
    governor.evaluate()
    fake.windowState.visible = false
    governor.evaluate()

    expect(log.mock.calls.map(([message]) => message)).toEqual([
      '[PerfGovernor] active -> passive',
      '[PerfGovernor] passive -> background',
    ])
  })
})

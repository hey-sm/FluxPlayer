import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class MockBrowserWindow {},
  screen: {},
  shell: {},
}))

import { loadMainWindowContent, type MainWindowLoader } from '../../src/main/windows/main-window'

function loader(
  loadURL: MainWindowLoader['loadURL'],
): MainWindowLoader & { destroy: ReturnType<typeof vi.fn> } {
  let destroyed = false
  const destroy = vi.fn(() => {
    destroyed = true
  })
  return {
    loadURL,
    isDestroyed: () => destroyed,
    destroy,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('main window loading', () => {
  it('clears its watchdog after a successful load', async () => {
    vi.useFakeTimers()
    const win = loader(vi.fn().mockResolvedValue(undefined))

    await expect(loadMainWindowContent(win, 'flux://app/index.html', 50)).resolves.toBeUndefined()

    expect(win.destroy).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('destroys the partial window and propagates loadURL failures', async () => {
    vi.useFakeTimers()
    const win = loader(vi.fn().mockRejectedValue(new Error('ERR_FAILED')))

    await expect(loadMainWindowContent(win, 'flux://app/index.html', 50)).rejects.toThrow(
      'MAIN_WINDOW_LOAD_FAILED: ERR_FAILED',
    )

    expect(win.destroy).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('destroys the partial window when loadURL never settles', async () => {
    vi.useFakeTimers()
    const win = loader(vi.fn(() => new Promise<void>(() => undefined)))
    const loading = loadMainWindowContent(win, 'flux://app/index.html', 50)
    const rejected = expect(loading).rejects.toThrow('MAIN_WINDOW_LOAD_FAILED: LOAD_TIMEOUT')

    await vi.advanceTimersByTimeAsync(50)
    await rejected

    expect(win.destroy).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import type { DesktopWindowState } from '@shared/ipc-contract'
import { isWindowFullscreen } from '@renderer/components/shell/window-state'

function windowState(overrides: Partial<DesktopWindowState> = {}): DesktopWindowState {
  return {
    isMaximized: false,
    isNativeFullScreen: false,
    isHtmlFullScreen: false,
    isWindowFullScreen: false,
    isFullScreen: false,
    isMinimized: false,
    isVisible: true,
    isFocused: true,
    displayId: 1,
    primaryDisplayId: 1,
    isPrimaryDisplay: true,
    hasDisplayOnLeft: false,
    hasDisplayOnRight: false,
    displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    ...overrides,
  }
}

describe('top bar fullscreen state', () => {
  it('reports fullscreen for both the native and the borderless toggle states', () => {
    expect(isWindowFullscreen(windowState({ isNativeFullScreen: true, isFullScreen: true }))).toBe(true)
    // The main process flips this flag before the native transition lands, so the label updates at once.
    expect(isWindowFullscreen(windowState({ isWindowFullScreen: true, isFullScreen: true }))).toBe(true)
  })

  it('stays windowed for HTML element fullscreen, which the toggle cannot exit', () => {
    expect(isWindowFullscreen(windowState({ isHtmlFullScreen: true, isFullScreen: true }))).toBe(false)
    expect(isWindowFullscreen(windowState({ isMaximized: true }))).toBe(false)
    expect(isWindowFullscreen(windowState())).toBe(false)
    expect(isWindowFullscreen(null)).toBe(false)
    expect(isWindowFullscreen(undefined)).toBe(false)
  })
})

import type { DesktopWindowState } from '@shared/ipc-contract'

/**
 * True while the window sits in the state `toggleFullscreen()` would leave.
 *
 * HTML element fullscreen is deliberately excluded: the main process toggle only tracks native and
 * borderless fullscreen, so the top bar must not offer "恢复" for a state its click cannot exit.
 */
export function isWindowFullscreen(state: DesktopWindowState | null | undefined): boolean {
  return Boolean(state && (state.isNativeFullScreen || state.isWindowFullScreen))
}

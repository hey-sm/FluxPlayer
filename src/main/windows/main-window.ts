import { BrowserWindow, screen, shell } from 'electron'
import type { DesktopWindowState, DisplayState } from '@shared/ipc-contract'
import { IPC } from '@shared/ipc-contract'

const WINDOWED_ASPECT = 16 / 9
const WINDOWED_SCALE = 3 / 4
const WINDOWED_MARGIN = 32
const MIN_WINDOWED_WIDTH = 960
const MIN_WINDOWED_HEIGHT = 540

let htmlFullscreenActive = false
let windowFullscreenActive = false
let stateTimer: NodeJS.Timeout | null = null

function rectsOverlapOnY(a: any, b: any): boolean {
  if (!a || !b) return false
  const aTop = Number(a.y) || 0
  const bTop = Number(b.y) || 0
  const aBottom = aTop + (Number(a.height) || 0)
  const bBottom = bTop + (Number(b.height) || 0)
  return aBottom > bTop && bBottom > aTop
}

function getDisplayState(win: BrowserWindow | null): DisplayState {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const display = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : primary
  const bounds = display && display.bounds ? display.bounds : primary.bounds
  const displayId = display && display.id
  const edgeTolerance = 2
  const hasDisplayOnLeft = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false
    return (
      rectsOverlapOnY(bounds, candidate.bounds) &&
      Math.abs(candidate.bounds.x + candidate.bounds.width - bounds.x) <= edgeTolerance
    )
  })
  const hasDisplayOnRight = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false
    return (
      rectsOverlapOnY(bounds, candidate.bounds) &&
      Math.abs(bounds.x + bounds.width - candidate.bounds.x) <= edgeTolerance
    )
  })
  return {
    displayId,
    primaryDisplayId: primary && primary.id,
    isPrimaryDisplay: !!(display && primary && display.id === primary.id),
    hasDisplayOnLeft,
    hasDisplayOnRight,
    displayBounds: bounds
      ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
      : null,
  }
}

export function getWindowState(win: BrowserWindow | null): DesktopWindowState {
  if (!win || win.isDestroyed()) {
    return {
      isMaximized: false,
      isNativeFullScreen: false,
      isHtmlFullScreen: false,
      isWindowFullScreen: false,
      isFullScreen: false,
      isMinimized: false,
      isVisible: false,
      isFocused: false,
      displayId: undefined,
      primaryDisplayId: undefined,
      isPrimaryDisplay: true,
      hasDisplayOnLeft: false,
      hasDisplayOnRight: false,
      displayBounds: null,
    }
  }
  return {
    isMaximized: win.isMaximized(),
    isNativeFullScreen: win.isFullScreen(),
    isHtmlFullScreen: htmlFullscreenActive,
    isWindowFullScreen: windowFullscreenActive,
    isFullScreen: win.isFullScreen() || htmlFullscreenActive || windowFullscreenActive,
    isMinimized: win.isMinimized(),
    isVisible: win.isVisible(),
    isFocused: win.isFocused(),
    ...getDisplayState(win),
  }
}

export function sendWindowState(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.windowStateChanged, getWindowState(win))
}

function scheduleWindowStateSend(win: BrowserWindow | null, delay = 80): void {
  if (!win || win.isDestroyed()) return
  if (stateTimer) clearTimeout(stateTimer)
  stateTimer = setTimeout(() => {
    stateTimer = null
    sendWindowState(win)
  }, delay)
}

function getWindowedBounds(win?: BrowserWindow | null) {
  const display =
    win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()
  const area = display.workArea
  const basis = display.bounds || area
  const maxWidth = Math.max(640, area.width - WINDOWED_MARGIN)
  const maxHeight = Math.max(360, area.height - WINDOWED_MARGIN)

  let width = Math.round(basis.width * WINDOWED_SCALE)
  let height = Math.round(width / WINDOWED_ASPECT)
  const scaledHeight = Math.round(basis.height * WINDOWED_SCALE)

  if (height > scaledHeight) {
    height = scaledHeight
    width = Math.round(height * WINDOWED_ASPECT)
  }
  if (width < MIN_WINDOWED_WIDTH && maxWidth >= MIN_WINDOWED_WIDTH && maxHeight >= MIN_WINDOWED_HEIGHT) {
    width = MIN_WINDOWED_WIDTH
    height = MIN_WINDOWED_HEIGHT
  }
  if (width > maxWidth) {
    width = maxWidth
    height = Math.round(width / WINDOWED_ASPECT)
  }
  if (height > maxHeight) {
    height = maxHeight
    width = Math.round(height * WINDOWED_ASPECT)
  }

  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  }
}

function applyWindowedBounds(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isMaximized()) win.unmaximize()
  win.setMinimumSize(MIN_WINDOWED_WIDTH, MIN_WINDOWED_HEIGHT)
  win.setBounds(getWindowedBounds(win), false)
  sendWindowState(win)
}

export function exitFullscreenToWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  windowFullscreenActive = false
  if (!win.isFullScreen()) {
    applyWindowedBounds(win)
    return
  }
  let applied = false
  const applyOnce = () => {
    if (applied || !win || win.isDestroyed() || win.isFullScreen()) return
    applied = true
    applyWindowedBounds(win)
  }
  win.once('leave-full-screen', () => setTimeout(applyOnce, 50))
  win.setFullScreen(false)
  setTimeout(applyOnce, 500)
}

export function toggleFullscreen(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isFullScreen() || windowFullscreenActive) {
    exitFullscreenToWindow(win)
    return
  }
  windowFullscreenActive = true
  win.setFullScreen(true)
  sendWindowState(win)
}

export interface MainWindowOptions {
  serverPort: number
  preloadPath: string
  iconPath?: string
  /** 开发模式下 electron-vite 提供的 renderer dev server 地址（legacy 模式忽略） */
  devRendererUrl?: string
  onStateChange?: (win: BrowserWindow) => void
  /** Called synchronously before loadURL so startup IPC can verify the primary renderer sender. */
  onCreated?: (win: BrowserWindow) => void
}

/**
 * 创建主窗口。默认尝试透明无框窗口（玻璃视觉的前提）；
 * 部分 GPU/驱动/远程会话下透明窗口会导致渲染进程崩溃（首次加载 ERR_FAILED），
 * 此时自动降级为不透明深色窗口重建。FLUX_OPAQUE=1 可强制不透明。
 */
export async function createMainWindow(options: MainWindowOptions): Promise<BrowserWindow> {
  htmlFullscreenActive = false
  windowFullscreenActive = false
  const preferTransparent = process.env.FLUX_OPAQUE !== '1'
  return buildAndLoad(preferTransparent, options)
}

const loadedWindows = new WeakSet<BrowserWindow>()

/** 首屏是否真实加载成功（烟雾测试用，防止服务通了但窗口没渲染的假成功） */
export function didWindowLoad(win: BrowserWindow | null): boolean {
  return !!win && !win.isDestroyed() && loadedWindows.has(win)
}

async function buildAndLoad(transparent: boolean, options: MainWindowOptions): Promise<BrowserWindow> {
  const win = buildWindow(transparent, options)
  const target = options.devRendererUrl || `http://127.0.0.1:${options.serverPort}`
  try {
    // 某些环境下渲染进程崩溃会让 loadURL 永不 settle，必须加超时竞速
    await Promise.race([
      win.loadURL(target),
      new Promise((_, reject) => setTimeout(() => reject(new Error('LOAD_TIMEOUT')), 15000)),
    ])
    loadedWindows.add(win)
  } catch (e: any) {
    if (transparent) {
      console.warn(`[FluxPlayer] 透明窗口加载失败（${e.message}），降级为不透明窗口重建`)
      // 先创建替代窗口再销毁旧窗口，避免出现零窗口瞬间触发 window-all-closed → app.quit()
      const fallback = buildAndLoad(false, options)
      try {
        win.destroy()
      } catch {
        /* ignore */
      }
      return fallback
    }
    console.error('Main window load failed:', e.message)
  }
  return win
}

function buildWindow(transparent: boolean, options: MainWindowOptions): BrowserWindow {
  const initialBounds = getWindowedBounds()
  const win = new BrowserWindow({
    ...initialBounds,
    minWidth: MIN_WINDOWED_WIDTH,
    minHeight: MIN_WINDOWED_HEIGHT,
    show: false,
    frame: false,
    fullscreen: false,
    transparent,
    backgroundColor: transparent ? '#00000000' : '#0b0d12',
    hasShadow: true,
    autoHideMenuBar: true,
    title: 'FluxPlayer',
    icon: options.iconPath,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      additionalArguments: [`--flux-api-base=http://127.0.0.1:${options.serverPort}`],
    },
  })
  options.onCreated?.(win)

  win.webContents.on('render-process-gone', (_event, details) => {
    console.warn('[FluxPlayer] renderer gone:', details.reason, details.exitCode)
  })

  const allowedOrigin = new URL(options.devRendererUrl || `http://127.0.0.1:${options.serverPort}`).origin
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'http:' || target.protocol === 'https:') void shell.openExternal(target.href)
    } catch {
      // Invalid URLs remain denied.
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin === allowedOrigin) return
    } catch {
      // Invalid URLs are always blocked.
    }
    event.preventDefault()
    try {
      const target = new URL(url)
      if (target.protocol === 'http:' || target.protocol === 'https:') void shell.openExternal(target.href)
    } catch {
      // Keep malformed navigation blocked.
    }
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'Escape' || input.code === 'Escape') && win.isFullScreen()) {
      event.preventDefault()
      exitFullscreenToWindow(win)
    }
  })

  const notify = () => {
    sendWindowState(win)
    options.onStateChange?.(win)
  }
  const notifyDebounced = () => {
    scheduleWindowStateSend(win)
    options.onStateChange?.(win)
  }

  win.webContents.once('did-finish-load', notify)
  win.once('ready-to-show', () => {
    win.show()
    notify()
  })
  for (const event of ['maximize', 'unmaximize', 'minimize', 'restore', 'show', 'hide', 'focus', 'blur'] as const) {
    win.on(event as any, notify)
  }
  win.on('move', notifyDebounced)
  win.on('resize', notifyDebounced)
  win.on('enter-full-screen', () => {
    windowFullscreenActive = true
    notify()
  })
  win.on('leave-full-screen', () => {
    windowFullscreenActive = false
    setTimeout(() => applyWindowedBounds(win), 50)
  })
  win.on('enter-html-full-screen', () => {
    htmlFullscreenActive = true
    notify()
  })
  win.on('leave-html-full-screen', () => {
    htmlFullscreenActive = false
    setTimeout(() => applyWindowedBounds(win), 50)
  })
  win.on('closed', () => {
    if (stateTimer) {
      clearTimeout(stateTimer)
      stateTimer = null
    }
  })

  return win
}

export function focusMainWindow(win: BrowserWindow | null): boolean {
  if (!win || win.isDestroyed()) return false
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  sendWindowState(win)
  return true
}

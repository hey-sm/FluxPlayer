import { BrowserWindow, dialog, globalShortcut, ipcMain } from 'electron'
import { IPC, type HotkeyBinding, type HotkeyConfigureResult } from '@shared/ipc-contract'
import type { UpdaterCommandResult, UpdaterState } from '@shared/updater-contract'
import type { WallpaperEngineImportRequest } from '@shared/custom-background-contract'
import type { CustomBackgroundService } from './background/custom-background'
import { exitFullscreenToWindow, getWindowState, toggleFullscreen } from './windows/main-window'
import {
  clearNeteaseMusicLoginSession,
  clearQQMusicLoginSession,
  openNeteaseMusicLoginWindow,
  openQQMusicLoginWindow,
} from './windows/login-windows'
import type { UpdaterController } from './updater'

const registeredGlobalHotkeys = new Map<string, string>()

function getSenderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function sendGlobalHotkeyAction(getMainWindow: () => BrowserWindow | null, action: string): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || !action) return
  win.webContents.send(IPC.globalHotkey, { action })
}

export function unregisterGlobalHotkeys(): void {
  for (const accelerator of registeredGlobalHotkeys.keys()) {
    try {
      globalShortcut.unregister(accelerator)
    } catch {
      /* ignore */
    }
  }
  registeredGlobalHotkeys.clear()
}

function configureGlobalHotkeys(
  getMainWindow: () => BrowserWindow | null,
  bindings: HotkeyBinding[],
): HotkeyConfigureResult {
  unregisterGlobalHotkeys()
  const results: HotkeyConfigureResult['results'] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(bindings) ? bindings : []) {
    const action = item && String(item.action || '').trim()
    const accelerator = item && String(item.accelerator || '').trim()
    if (!action || !accelerator || seen.has(accelerator)) continue
    seen.add(accelerator)
    let registered = false
    try {
      registered = globalShortcut.register(accelerator, () => sendGlobalHotkeyAction(getMainWindow, action))
    } catch {
      registered = false
    }
    if (registered) {
      registeredGlobalHotkeys.set(accelerator, action)
      results.push({ action, accelerator, ok: true })
    } else {
      results.push({
        action,
        accelerator,
        ok: false,
        conflict: {
          sourceName: '系统 / 其他软件',
          sourceIcon: 'warning',
          reason: '该组合键已被占用或被系统保留',
        },
      })
    }
  }
  return { ok: true, results }
}

export interface IpcDeps {
  getMainWindow: () => BrowserWindow | null
  getPrimaryRendererOrigin: () => string
  getCustomBackgroundService: () => CustomBackgroundService
  getUpdaterController: () => UpdaterController | null
  getUpdaterFallbackState: () => UpdaterState
  requestQuit: () => void
  restartApp: () => Promise<void>
}

function isPrimaryRenderer(event: Electron.IpcMainInvokeEvent, deps: IpcDeps): boolean {
  const senderWindow = getSenderWindow(event)
  const frame = event.senderFrame
  if (
    !senderWindow ||
    senderWindow !== deps.getMainWindow() ||
    !frame ||
    frame !== event.sender.mainFrame ||
    frame.isDestroyed()
  ) {
    return false
  }
  try {
    return new URL(frame.url).origin === deps.getPrimaryRendererOrigin()
  } catch {
    return false
  }
}

function unavailableUpdaterResult(deps: IpcDeps, code: string, message: string): UpdaterCommandResult {
  return { ok: false, state: deps.getUpdaterFallbackState(), error: { code, message } }
}

export function registerIpcHandlers(deps: IpcDeps): void {
  // ---- 窗口控制 ----
  ipcMain.handle(IPC.windowMinimize, (event) => {
    getSenderWindow(event)?.minimize()
  })
  ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    toggleFullscreen(getSenderWindow(event))
  })
  ipcMain.handle(IPC.windowToggleFullscreen, (event) => {
    toggleFullscreen(getSenderWindow(event))
  })
  ipcMain.handle(IPC.windowExitFullscreenWindowed, (event) => {
    exitFullscreenToWindow(getSenderWindow(event))
  })
  ipcMain.handle(IPC.windowGetState, (event) => getWindowState(getSenderWindow(event)))
  ipcMain.handle(IPC.windowClose, (event) => {
    if (getSenderWindow(event) === deps.getMainWindow()) deps.requestQuit()
  })

  // ---- 全局快捷键 ----
  ipcMain.handle(IPC.configureGlobalHotkeys, (_event, bindings) =>
    configureGlobalHotkeys(deps.getMainWindow, bindings),
  )

  // ---- 登录窗口 ----
  ipcMain.handle(IPC.neteaseOpenLogin, async (event) => openNeteaseMusicLoginWindow(getSenderWindow(event)))
  ipcMain.handle(IPC.neteaseClearLogin, async () => clearNeteaseMusicLoginSession())
  ipcMain.handle(IPC.qqOpenLogin, async (event) => openQQMusicLoginWindow(getSenderWindow(event)))
  ipcMain.handle(IPC.qqClearLogin, async () => clearQQMusicLoginSession())

  // ---- 应用 ----
  ipcMain.handle(IPC.restartApp, async () => {
    try {
      await deps.restartApp()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message || 'RESTART_FAILED' }
    }
  })

  // ---- M6 explicit electron-updater workflow ----
  ipcMain.handle(IPC.updaterGetState, (event) => {
    if (!isPrimaryRenderer(event, deps)) return deps.getUpdaterFallbackState()
    return deps.getUpdaterController()?.getState() ?? deps.getUpdaterFallbackState()
  })
  ipcMain.handle(IPC.updaterCheck, (event) => {
    if (!isPrimaryRenderer(event, deps)) {
      return unavailableUpdaterResult(deps, 'UNTRUSTED_UPDATER_SENDER', 'Updater command rejected.')
    }
    return deps.getUpdaterController()?.check() ??
      unavailableUpdaterResult(deps, 'UPDATER_NOT_AVAILABLE', 'Updater is not available.')
  })
  ipcMain.handle(IPC.updaterDownload, (event) => {
    if (!isPrimaryRenderer(event, deps)) {
      return unavailableUpdaterResult(deps, 'UNTRUSTED_UPDATER_SENDER', 'Updater command rejected.')
    }
    return deps.getUpdaterController()?.download() ??
      unavailableUpdaterResult(deps, 'UPDATER_NOT_AVAILABLE', 'Updater is not available.')
  })
  ipcMain.handle(IPC.updaterInstall, (event) => {
    if (!isPrimaryRenderer(event, deps)) {
      return unavailableUpdaterResult(deps, 'UNTRUSTED_UPDATER_SENDER', 'Updater command rejected.')
    }
    return deps.getUpdaterController()?.install() ??
      unavailableUpdaterResult(deps, 'UPDATER_NOT_AVAILABLE', 'Updater is not available.')
  })

  ipcMain.handle(IPC.customBackgroundGet, (event) => {
    if (!isPrimaryRenderer(event, deps)) return null
    return deps.getCustomBackgroundService().getCurrent()
  })
  ipcMain.handle(IPC.customBackgroundChooseFile, async (event) => {
    if (!isPrimaryRenderer(event, deps)) return { ok: false, background: null, error: 'UNTRUSTED_BACKGROUND_SENDER' }
    const owner = getSenderWindow(event) || undefined
    const choice = await dialog.showOpenDialog(owner as BrowserWindow, {
      title: '选择自定义背景', properties: ['openFile'],
      filters: [
        { name: '图片和视频', extensions: ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp', 'm4v', 'mov', 'mp4', 'webm'] },
      ],
    })
    if (choice.canceled || !choice.filePaths[0]) return { ok: false, background: deps.getCustomBackgroundService().getCurrent(), canceled: true }
    const result = deps.getCustomBackgroundService().importFile(choice.filePaths[0])
    if (result.ok) deps.getMainWindow()?.webContents.send(IPC.customBackgroundChanged, result.background)
    return result
  })
  ipcMain.handle(IPC.customBackgroundClear, (event) => {
    if (!isPrimaryRenderer(event, deps)) return { ok: false, background: null, error: 'UNTRUSTED_BACKGROUND_SENDER' }
    const result = deps.getCustomBackgroundService().clear()
    if (result.ok) deps.getMainWindow()?.webContents.send(IPC.customBackgroundChanged, null)
    return result
  })
  ipcMain.handle(IPC.customBackgroundScanWallpaperEngine, (event) => {
    if (!isPrimaryRenderer(event, deps)) return { ok: false, projects: [], error: 'UNTRUSTED_BACKGROUND_SENDER' }
    return deps.getCustomBackgroundService().scanWallpaperEngine()
  })
  ipcMain.handle(IPC.customBackgroundImportWallpaperEngine, (event, request: WallpaperEngineImportRequest) => {
    if (!isPrimaryRenderer(event, deps)) return { ok: false, background: null, error: 'UNTRUSTED_BACKGROUND_SENDER' }
    const projectId = request && typeof request.projectId === 'string' ? request.projectId : ''
    const result = deps.getCustomBackgroundService().importScannedProject(projectId)
    if (result.ok) deps.getMainWindow()?.webContents.send(IPC.customBackgroundChanged, result.background)
    return result
  })
  ipcMain.handle(IPC.customBackgroundChooseWallpaperEngine, async (event) => {
    if (!isPrimaryRenderer(event, deps)) return { ok: false, background: null, error: 'UNTRUSTED_BACKGROUND_SENDER' }
    const owner = getSenderWindow(event) || undefined
    const choice = await dialog.showOpenDialog(owner as BrowserWindow, {
      title: '导入 Wallpaper Engine 视频项目',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Wallpaper Engine project.json', extensions: ['json'] }],
    })
    if (choice.canceled || !choice.filePaths[0]) return { ok: false, background: deps.getCustomBackgroundService().getCurrent(), canceled: true }
    const result = deps.getCustomBackgroundService().importProjectPath(choice.filePaths[0])
    if (result.ok) deps.getMainWindow()?.webContents.send(IPC.customBackgroundChanged, result.background)
    return result
  })
}

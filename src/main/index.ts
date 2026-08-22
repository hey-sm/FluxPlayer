import './e2e-network-guard'
import { BrowserWindow, app, powerMonitor, screen, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '@shared/ipc-contract'
import { DEFAULT_UPDATER_STATE, type UpdaterState } from '@shared/updater-contract'
import { SafeCredentialStore } from './credentials'
import { createElectronUpdaterAdapter, UpdaterController } from './updater'
import { isWallpaperRuntimeSelectionActive, registerIpcHandlers } from './ipc'
import { PerfGovernor } from './perf-governor'
import { createMainWindow, didWindowLoad, focusMainWindow, getWindowState } from './windows/main-window'
import { CustomBackgroundService } from './background/custom-background'
import { WallpaperEngineLibrary } from './background/wallpaper-engine-library'
import { WallpaperEngineStore, resetLegacyBackgroundStorage } from './background/wallpaper-engine-store'
import { WallpaperEngineRuntime } from './background/wallpaper-engine-runtime'
import {
  APP_ENTRY_URL,
  AudioHandleStore,
  registerPrivilegedSchemes,
  registerProtocolHandlers,
} from './protocols'
import { createMainMusicService } from './music-service'
import { ChkszPreferenceStore } from './chksz-preferences'

const APP_NAME = 'FluxPlayer'
const APP_USER_MODEL_ID = 'com.fluxplayer.app'

// Identity and privileged schemes must be fixed before app.whenReady().
app.setName(APP_NAME)
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)
registerPrivilegedSchemes()

// 主进程未捕获异常默认直接终止进程，用户看到的是「程序凭空消失」。这里兜住并留下日志，
// 让崩因至少可追。不做自动恢复：状态已不可信，继续跑比退出更危险。
process.on('uncaughtException', (error) => {
  console.error('[FluxPlayer] uncaught exception in main process:', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('[FluxPlayer] unhandled rejection in main process:', reason)
})
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const isSmokeTest = process.env.FLUX_SMOKE === '1'
const isDevelopment = !app.isPackaged || Boolean(process.env.ELECTRON_RENDERER_URL)

let mainWindow: BrowserWindow | null = null
let primaryRendererOrigin = APP_ENTRY_URL
let customBackgroundService: CustomBackgroundService | null = null
let wallpaperEngineLibrary: WallpaperEngineLibrary | null = null
let wallpaperEngineStore: WallpaperEngineStore | null = null
let wallpaperEngineRuntime: WallpaperEngineRuntime | null = null
let updaterController: UpdaterController | null = null
let allowQuit = false
let runtimeCleaned = false
let shutdownPromise: Promise<void> | null = null
const perfGovernor = new PerfGovernor()
const credentialStore = new SafeCredentialStore()
const chkszPreferences = new ChkszPreferenceStore(app.getPath('userData'))
const musicService = createMainMusicService(credentialStore, chkszPreferences)
const audioHandles = new AudioHandleStore()

function isTrustedDisplayMediaRequest(request: Electron.DisplayMediaRequestHandlerHandlerRequest): boolean {
  const win = mainWindow
  const frame = request.frame
  if (
    !win ||
    win.isDestroyed() ||
    !frame ||
    frame !== win.webContents.mainFrame ||
    frame.parent ||
    !request.videoRequested ||
    request.audioRequested
  )
    return false
  try {
    const expected = new URL(primaryRendererOrigin)
    const actual = new URL(request.securityOrigin || frame.url)
    if (expected.protocol === 'flux:') {
      return actual.protocol === 'flux:' && actual.hostname === 'app' && !actual.port
    }
    return actual.origin === expected.origin
  } catch {
    return false
  }
}

function configureDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!isTrustedDisplayMediaRequest(request)) {
        callback({})
        return
      }
      const source = wallpaperEngineRuntime?.takePreparedGlassSamplerSource()
      callback(source ? { video: source } : {})
    },
    { useSystemPicker: false },
  )
}

async function cleanupRuntime(disposeUpdater: boolean): Promise<void> {
  if (!runtimeCleaned) {
    perfGovernor.destroy()
    audioHandles.clear()
    runtimeCleaned = true
  }
  if (disposeUpdater) {
    updaterController?.dispose()
    updaterController = null
  }
}

async function cleanupForExit(): Promise<void> {
  try {
    session.defaultSession.setDisplayMediaRequestHandler(null)
  } catch {
    // The session may already be tearing down during an abnormal exit.
  }
  await wallpaperEngineRuntime?.dispose()
  wallpaperEngineLibrary?.dispose()
  await cleanupRuntime(true)
}

function requestQuit(): void {
  if (allowQuit || shutdownPromise) return
  shutdownPromise = cleanupForExit().finally(() => {
    allowQuit = true
    app.quit()
  })
}

async function restartApp(): Promise<void> {
  if (allowQuit) return
  if (!shutdownPromise) {
    shutdownPromise = cleanupForExit().then(() => {
      app.relaunch()
      allowQuit = true
      app.quit()
    })
  }
  await shutdownPromise
}

function broadcastUpdaterState(state: UpdaterState): void {
  const win = mainWindow
  if (win && !win.isDestroyed()) win.webContents.send(IPC.updaterStateChanged, state)
}

function updaterFallbackState(error?: unknown): UpdaterState {
  return {
    ...DEFAULT_UPDATER_STATE,
    currentVersion: app.getVersion(),
    disabledReason: isSmokeTest ? 'smoke' : isDevelopment ? 'development' : null,
    ...(error
      ? {
          status: 'error' as const,
          error: {
            code: 'UPDATER_INITIALIZATION_FAILED',
            message: error instanceof Error ? error.message : 'Could not initialize updater',
          },
        }
      : {}),
  }
}

async function initializeUpdater(): Promise<UpdaterState> {
  if (isDevelopment || isSmokeTest) return updaterFallbackState()
  try {
    const adapter = await createElectronUpdaterAdapter()
    updaterController = new UpdaterController({
      adapter,
      currentVersion: app.getVersion(),
      prepareForInstall: () => cleanupRuntime(false),
      onStateChange: broadcastUpdaterState,
    })
    return updaterController.getState()
  } catch (error) {
    console.warn('[Updater] initialization failed:', error)
    return updaterFallbackState(error)
  }
}

function resolveStaticRoot(): string {
  return path.join(import.meta.dirname, '../renderer')
}

function preloadPath(): string {
  return path.join(import.meta.dirname, '../preload', 'main.cjs')
}

async function createWindow(): Promise<void> {
  const devRendererUrl = process.env.ELECTRON_RENDERER_URL || undefined
  const iconPath = path.join(app.getAppPath(), 'resources', 'icon.png')

  try {
    mainWindow = await createMainWindow({
      preloadPath: preloadPath(),
      iconPath: fs.existsSync(iconPath) ? iconPath : undefined,
      devRendererUrl,
      onStateChange: (window) => {
        perfGovernor.evaluate()
        const state = getWindowState(window)
        if (state.isMinimized || !state.isVisible) void wallpaperEngineRuntime?.suspend()
        else {
          void wallpaperEngineRuntime?.resume()
          void wallpaperEngineRuntime?.refreshBounds()
        }
      },
      onRendererGone: () => {
        void wallpaperEngineRuntime?.stop()
      },
      onCreated: (window) => {
        mainWindow = window
      },
    })
  } catch (error) {
    if (mainWindow?.isDestroyed()) mainWindow = null
    throw error
  }
  perfGovernor.attach(mainWindow)
  mainWindow.on('close', (event) => {
    if (allowQuit) return
    event.preventDefault()
    requestQuit()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (isSmokeTest) runSmokeTest()
}

function runSmokeTest(): void {
  const fail = setTimeout(() => {
    console.error('[smoke] FAILED: timeout')
    app.exit(1)
  }, 30000)
  if (didWindowLoad(mainWindow)) {
    console.log(`[smoke] OK version=${app.getVersion()} windowLoaded=true noLocalTcp=true`)
    clearTimeout(fail)
    setTimeout(() => app.exit(0), 300)
    return
  }
  console.error('[smoke] FAILED: main window did not load')
  clearTimeout(fail)
  app.exit(1)
}

async function resumeWallpaperEngineSelection(): Promise<void> {
  const library = wallpaperEngineLibrary
  const store = wallpaperEngineStore
  const runtime = wallpaperEngineRuntime
  if (!library || !store || !runtime) return
  const current = store.get()
  if (!current.selection.active) return
  try {
    const selection = await library.resolveSelection(current.selection.id)
    const project = await library.getProject(current.selection.id)
    const status = await runtime.activate(project, selection)
    const latest = store.get()
    if (
      latest.selection.id !== current.selection.id ||
      latest.selection.updatedAt !== current.selection.updatedAt ||
      status.projectId !== current.selection.id
    ) {
      return
    }
    const next = isWallpaperRuntimeSelectionActive(status)
      ? store.setSelection({ ...selection, active: true, runtimeError: '' })
      : store.deactivateSelection(selection.id, status.error || 'WALLPAPER_ENGINE_RUNTIME_UNAVAILABLE')
    mainWindow?.webContents.send(IPC.wallpaperEngineStateChanged, next)
  } catch {
    const next = store.deactivateSelection(current.selection.id, 'WALLPAPER_ENGINE_PROJECT_OFFLINE')
    mainWindow?.webContents.send(IPC.wallpaperEngineStateChanged, next)
  }
}

const gotSingleInstanceLock = isSmokeTest || process.env.FLUX_E2E === '1' || app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  app.on('second-instance', () => {
    if (!focusMainWindow(mainWindow)) {
      app
        .whenReady()
        .then(() => createWindow())
        .catch((error) => {
          console.error('Second instance window restore failed:', error)
          requestQuit()
        })
    }
  })

  app
    .whenReady()
    .then(async () => {
      if (isSmokeTest) {
        const watchdog = setTimeout(() => {
          console.error('[smoke] FAILED: global watchdog timeout')
          app.exit(1)
        }, 60000)
        watchdog.unref()
      }

      primaryRendererOrigin = process.env.ELECTRON_RENDERER_URL || APP_ENTRY_URL
      const userDataPath = app.getPath('userData')
      resetLegacyBackgroundStorage(userDataPath)
      customBackgroundService = new CustomBackgroundService({ userDataPath })
      wallpaperEngineStore = new WallpaperEngineStore(userDataPath)
      wallpaperEngineLibrary = new WallpaperEngineLibrary({
        userDataPath,
        onProjectUnavailable: (id, error) => {
          const store = wallpaperEngineStore
          if (!store) return
          const before = store.get()
          if (before.selection.id !== id || !before.selection.active) return
          const next = store.deactivateSelection(id, error)
          void wallpaperEngineRuntime?.stop()
          mainWindow?.webContents.send(IPC.wallpaperEngineStateChanged, next)
        },
      })
      wallpaperEngineRuntime = new WallpaperEngineRuntime({
        userDataPath,
        resolveNativeSceneTarget: async (id) => {
          if (!wallpaperEngineLibrary) throw new Error('WALLPAPER_ENGINE_LIBRARY_NOT_READY')
          return wallpaperEngineLibrary.getNativeSceneTarget(id)
        },
        resolveHost: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return null
          const physicalBounds = screen.dipToScreenRect(mainWindow, mainWindow.getContentBounds())
          const nativeHandle = mainWindow.getNativeWindowHandle()
          const windowHandle =
            nativeHandle.length >= 8
              ? nativeHandle.readBigUInt64LE(0).toString()
              : String(nativeHandle.readUInt32LE(0))
          return {
            windowHandle,
            executable: process.execPath,
            bounds: physicalBounds,
          }
        },
        onNativeWindowReady: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return
          // The carrier must stay alive while it is being captured, but the
          // FluxPlayer window remains the only user-facing window.
          mainWindow.webContents.setBackgroundThrottling(false)
          mainWindow.moveTop()
        },
        onNativeWindowStopped: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return
          mainWindow.webContents.setBackgroundThrottling(true)
        },
        onStatusChanged: (status) => {
          mainWindow?.webContents.send(IPC.wallpaperEngineRuntimeChanged, status)
          if (status.phase !== 'failed' || !status.projectId || !wallpaperEngineStore) return
          const current = wallpaperEngineStore.get()
          if (!current.selection.active || current.selection.id !== status.projectId) return
          const next = wallpaperEngineStore.deactivateSelection(status.projectId, status.error)
          mainWindow?.webContents.send(IPC.wallpaperEngineStateChanged, next)
        },
      })
      configureDisplayMediaHandler()
      registerProtocolHandlers({
        staticRoot: resolveStaticRoot(),
        audioHandles,
        customBackgroundService,
        wallpaperEngineLibrary,
      })
      const initialUpdaterState = await initializeUpdater()
      registerIpcHandlers({
        getMainWindow: () => mainWindow,
        getPrimaryRendererOrigin: () => primaryRendererOrigin,
        getCustomBackgroundService: () => {
          if (!customBackgroundService) throw new Error('CUSTOM_BACKGROUND_SERVICE_NOT_READY')
          return customBackgroundService
        },
        getWallpaperEngineLibrary: () => {
          if (!wallpaperEngineLibrary) throw new Error('WALLPAPER_ENGINE_LIBRARY_NOT_READY')
          return wallpaperEngineLibrary
        },
        getWallpaperEngineStore: () => {
          if (!wallpaperEngineStore) throw new Error('WALLPAPER_ENGINE_STORE_NOT_READY')
          return wallpaperEngineStore
        },
        getWallpaperEngineRuntime: () => {
          if (!wallpaperEngineRuntime) throw new Error('WALLPAPER_ENGINE_RUNTIME_NOT_READY')
          return wallpaperEngineRuntime
        },
        getUpdaterController: () => updaterController,
        getUpdaterFallbackState: () => initialUpdaterState,
        getMusicService: () => musicService,
        getCredentialStore: () => credentialStore,
        getChkszPreferences: () => chkszPreferences,
        audioHandles,
        requestQuit,
        restartApp,
      })
      await createWindow()
      const refreshWallpaperBounds = () => void wallpaperEngineRuntime?.refreshBounds()
      screen.on('display-metrics-changed', refreshWallpaperBounds)
      screen.on('display-added', refreshWallpaperBounds)
      screen.on('display-removed', refreshWallpaperBounds)
      powerMonitor.on('suspend', () => void wallpaperEngineRuntime?.suspend())
      powerMonitor.on('resume', () => void wallpaperEngineRuntime?.resume())
      powerMonitor.on('unlock-screen', () => void wallpaperEngineRuntime?.resume())
      void resumeWallpaperEngineSelection()
    })
    .catch(async (error) => {
      console.error('[FluxPlayer] startup failed:', error)
      try {
        await cleanupForExit()
      } catch (cleanupError) {
        console.error('[FluxPlayer] startup cleanup failed:', cleanupError)
      } finally {
        allowQuit = true
        app.exit(1)
      }
    })

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      void createWindow().catch((error) => {
        console.error('Application activation window restore failed:', error)
        requestQuit()
      })
      return
    }
    focusMainWindow(mainWindow)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !allowQuit) requestQuit()
  })

  app.on('before-quit', (event) => {
    if (runtimeCleaned) {
      allowQuit = true
      return
    }
    if (allowQuit) return
    event.preventDefault()
    requestQuit()
  })
}

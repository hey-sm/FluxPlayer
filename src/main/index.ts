import './e2e-network-guard'
import { BrowserWindow, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '@shared/ipc-contract'
import { DEFAULT_UPDATER_STATE, type UpdaterState } from '@shared/updater-contract'
import { SafeCredentialStore } from './credentials'
import { createElectronUpdaterAdapter, UpdaterController } from './updater'
import { registerIpcHandlers, unregisterGlobalHotkeys } from './ipc'
import { PerfGovernor } from './perf-governor'
import { createMainWindow, didWindowLoad, focusMainWindow } from './windows/main-window'
import { CustomBackgroundService } from './background/custom-background'
import {
  APP_ENTRY_URL,
  AudioHandleStore,
  registerPrivilegedSchemes,
  registerProtocolHandlers,
} from './protocols'
import { createMainMusicService } from './music-service'

const APP_NAME = 'FluxPlayer'
const APP_USER_MODEL_ID = 'com.fluxplayer.app'

// Identity and privileged schemes must be fixed before app.whenReady().
app.setName(APP_NAME)
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)
registerPrivilegedSchemes()
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const isSmokeTest = process.env.FLUX_SMOKE === '1'
const isDevelopment = !app.isPackaged || Boolean(process.env.ELECTRON_RENDERER_URL)

let mainWindow: BrowserWindow | null = null
let primaryRendererOrigin = APP_ENTRY_URL
let customBackgroundService: CustomBackgroundService | null = null
let updaterController: UpdaterController | null = null
let allowQuit = false
let runtimeCleaned = false
let shutdownPromise: Promise<void> | null = null
const perfGovernor = new PerfGovernor()
const credentialStore = new SafeCredentialStore()
const musicService = createMainMusicService(credentialStore)
const audioHandles = new AudioHandleStore()

async function cleanupRuntime(disposeUpdater: boolean): Promise<void> {
  if (!runtimeCleaned) {
    perfGovernor.destroy()
    audioHandles.clear()
    unregisterGlobalHotkeys()
    runtimeCleaned = true
  }
  if (disposeUpdater) {
    updaterController?.dispose()
    updaterController = null
  }
}

async function cleanupForExit(): Promise<void> {
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

  mainWindow = await createMainWindow({
    preloadPath: preloadPath(),
    iconPath: fs.existsSync(iconPath) ? iconPath : undefined,
    devRendererUrl,
    onStateChange: () => perfGovernor.evaluate(),
    onCreated: (window) => {
      mainWindow = window
    },
  })
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
        .catch((error) => console.error('Second instance window restore failed:', error))
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
      customBackgroundService = new CustomBackgroundService({ userDataPath: app.getPath('userData') })
      registerProtocolHandlers({
        staticRoot: resolveStaticRoot(),
        audioHandles,
        customBackgroundService,
      })
      const initialUpdaterState = await initializeUpdater()
      registerIpcHandlers({
        getMainWindow: () => mainWindow,
        getPrimaryRendererOrigin: () => primaryRendererOrigin,
        getCustomBackgroundService: () => {
          if (!customBackgroundService) throw new Error('CUSTOM_BACKGROUND_SERVICE_NOT_READY')
          return customBackgroundService
        },
        getUpdaterController: () => updaterController,
        getUpdaterFallbackState: () => initialUpdaterState,
        getMusicService: () => musicService,
        audioHandles,
        requestQuit,
        restartApp,
      })
      await createWindow()
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
    if (!mainWindow || mainWindow.isDestroyed()) void createWindow()
    else focusMainWindow(mainWindow)
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

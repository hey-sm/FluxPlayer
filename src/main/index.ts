import './e2e-network-guard'
import { BrowserWindow, app, net as electronNet, protocol } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { DEFAULT_UPDATER_STATE, type UpdaterState } from '@shared/updater-contract'
import net from 'node:net'
import path from 'node:path'
import fs from 'node:fs'
import { startLocalServer, type LocalServer } from '@server/index'
import { SafeCredentialStore } from './credentials'
import { createElectronUpdaterAdapter, UpdaterController } from './updater'
import { registerIpcHandlers, unregisterGlobalHotkeys } from './ipc'
import { PerfGovernor } from './perf-governor'
import { createMainWindow, didWindowLoad, focusMainWindow } from './windows/main-window'
import { CustomBackgroundService } from './background/custom-background'
import { CUSTOM_BACKGROUND_SCHEME } from '@shared/custom-background-contract'

const APP_NAME = 'FluxPlayer'
const APP_USER_MODEL_ID = 'com.fluxplayer.app'
const DEV_PORT_BASE = 43110

// Freeze the application identity before resolving userData-backed stores.
app.setName(APP_NAME)
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)
protocol.registerSchemesAsPrivileged([{
  scheme: CUSTOM_BACKGROUND_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

const isSmokeTest = process.env.FLUX_SMOKE === '1'

let mainWindow: BrowserWindow | null = null
let primaryRendererOrigin = ''
let localServer: LocalServer | null = null
let customBackgroundService: CustomBackgroundService | null = null
let updaterController: UpdaterController | null = null
let allowQuit = false
let runtimeCleaned = false
let shutdownPromise: Promise<void> | null = null
const perfGovernor = new PerfGovernor()
const credentialStore = new SafeCredentialStore()

const isDevelopment = !app.isPackaged || Boolean(process.env.ELECTRON_RENDERER_URL)

// 安装和退出共用清理顺序：壁纸轮询/detach -> 本地服务 -> 全局快捷键。
// 更新安装使用 strict=true，任何必要资源清理失败都会阻止 quitAndInstall。
async function cleanupRuntime(disposeUpdater: boolean, strict = false): Promise<void> {
  if (!runtimeCleaned) {
    const cleanupErrors: unknown[] = []
    perfGovernor.destroy()


    const server = localServer
    if (server) {
      try {
        await server.close()
        localServer = null
      } catch (error) {
        console.warn('[FluxPlayer] local server shutdown failed:', error)
        cleanupErrors.push(error)
        if (!strict) localServer = null
      }
    }
    unregisterGlobalHotkeys()

    if (strict && cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Runtime cleanup failed before update installation')
    }
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
  // Disabled modes do not even load electron-updater, preventing accidental network/update side effects.
  if (isDevelopment || isSmokeTest) return updaterFallbackState()
  try {
    const adapter = await createElectronUpdaterAdapter()
    updaterController = new UpdaterController({
      adapter,
      currentVersion: app.getVersion(),
      prepareForInstall: () => cleanupRuntime(false, true),
      onStateChange: broadcastUpdaterState,
    })
    return updaterController.getState()
  } catch (error) {
    console.warn('[Updater] initialization failed:', error)
    return updaterFallbackState(error)
  }
}

const CHROMIUM_PERFORMANCE_SWITCHES: Array<[string, string?]> = [
  ['autoplay-policy', 'no-user-gesture-required'],
  ['ignore-gpu-blocklist'],
  ['enable-gpu-rasterization'],
  ['enable-zero-copy'],
  ['enable-accelerated-2d-canvas'],
  ['disable-background-timer-throttling'],
  ['disable-renderer-backgrounding'],
  ['disable-backgrounding-occluded-windows'],
  ['use-angle', 'd3d11'],
]
for (const [name, value] of CHROMIUM_PERFORMANCE_SWITCHES) {
  if (value == null) app.commandLine.appendSwitch(name)
  else app.commandLine.appendSwitch(name, value)
}

function findOpenPort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    function tryPort(port: number): void {
      const tester = net.createServer()
      tester.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          tryPort(port + 1)
          return
        }
        reject(err)
      })
      tester.once('listening', () => {
        tester.close(() => resolve(port))
      })
      tester.listen(port, '127.0.0.1')
    }
    tryPort(startPort)
  })
}

function resolveStaticRoot(): string {
  return path.join(import.meta.dirname, '../renderer')
}

function preloadPath(): string {
  return path.join(import.meta.dirname, '../preload', 'main.cjs')
}

async function ensureLocalServer(): Promise<LocalServer> {
  if (localServer) return localServer
  // 正式版固定 origin，以确保 FluxPlayer 自身的 Web Storage/IndexedDB 跨启动稳定；
  // 开发、smoke 与 E2E 使用空闲端口，允许隔离并行运行。
  const isolatedRuntime = isDevelopment || isSmokeTest || process.env.FLUX_E2E === '1'
  const port = isolatedRuntime ? await findOpenPort(DEV_PORT_BASE) : DEV_PORT_BASE
  localServer = await startLocalServer({
    host: '127.0.0.1',
    port,
    staticRoot: resolveStaticRoot(),
    appVersion: app.getVersion(),
    credentials: credentialStore,
  })
  return localServer
}

async function createWindow(): Promise<void> {
  const server = await ensureLocalServer()
  const devRendererUrl = process.env.ELECTRON_RENDERER_URL || undefined

  const iconPath = path.join(app.getAppPath(), 'resources', 'icon.png')

  mainWindow = await createMainWindow({
    serverPort: server.port,
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



  if (isSmokeTest) runSmokeTest(server.port)
}

function runSmokeTest(port: number): void {
  const fail = setTimeout(() => {
    console.error('[smoke] FAILED: timeout')
    app.exit(1)
  }, 30000)
  const check = async () => {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/app/version`)
      const data: any = await resp.json()
      const windowLoaded = didWindowLoad(mainWindow)
      if (data && data.version && windowLoaded) {
        console.log(`[smoke] OK version=${data.version} windowLoaded=true`)
        clearTimeout(fail)
        setTimeout(() => app.exit(0), 300)
        return
      }
      throw new Error(windowLoaded ? 'bad version payload' : 'main window did not load')
    } catch (e: any) {
      console.error('[smoke] FAILED:', e.message)
      clearTimeout(fail)
      app.exit(1)
    }
  }
  // createMainWindow 返回时首屏加载已完成，直接校验
  void check()
}

// Automated harnesses are isolated and must not silently hand off to a concurrently running developer instance.
const gotSingleInstanceLock = isSmokeTest || process.env.FLUX_E2E === '1' || app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!focusMainWindow(mainWindow)) {
      app
        .whenReady()
        .then(() => createWindow())
        .catch((e) => console.error('Second instance window restore failed:', e))
    }
  })

  app.whenReady().then(async () => {
    // 烟雾测试看门狗必须在一切 await 之前装上，防止启动链路任何一步悬死
    if (isSmokeTest) {
      const watchdog: any = setTimeout(() => {
        console.error('[smoke] FAILED: global watchdog timeout')
        app.exit(1)
      }, 60000)
      watchdog.unref?.()
    }
    const server = await ensureLocalServer()
    const rendererUrl = process.env.ELECTRON_RENDERER_URL || `http://127.0.0.1:${server.port}`
    primaryRendererOrigin = new URL(rendererUrl).origin
    customBackgroundService = new CustomBackgroundService({ userDataPath: app.getPath('userData') })
    protocol.handle(CUSTOM_BACKGROUND_SCHEME, (request) => {
      const fileUrl = customBackgroundService?.resolveRequestUrl(request.url)
      return fileUrl ? electronNet.fetch(fileUrl) : new Response('Not found', { status: 404 })
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
      requestQuit,
      restartApp,
    })
    await createWindow()
  }).catch(async (error) => {
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

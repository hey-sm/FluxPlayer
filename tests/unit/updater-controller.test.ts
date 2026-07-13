import { describe, expect, it, vi } from 'vitest'
import type { UpdaterStatus } from '@shared/updater-contract'
import { UpdaterController } from '../../src/main/updater/controller'
import { FakeUpdaterAdapter } from '../../src/main/updater/fake-adapter'
import type { UpdaterCheckResult, UpdaterEventName } from '../../src/main/updater/adapter'

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function available(version = '2.0.0'): UpdaterCheckResult {
  return { isUpdateAvailable: true, updateInfo: { version } }
}

async function reachDownloaded(
  adapter: FakeUpdaterAdapter,
  prepareForInstall: () => void | Promise<void> = vi.fn(),
): Promise<UpdaterController> {
  const controller = new UpdaterController({ adapter, prepareForInstall })
  await expect(controller.check()).resolves.toMatchObject({ ok: true })
  await expect(controller.download()).resolves.toMatchObject({ ok: true })
  expect(controller.getState().status).toBe('downloaded')
  return controller
}

describe('UpdaterController', () => {
  it('does not auto-check and completes the explicit check/download/install chain in order', async () => {
    const order: string[] = []
    const adapter = new FakeUpdaterAdapter({
      currentVersion: '1.0.0',
      checkForUpdates: async (fake) => {
        fake.emit('checking-for-update')
        fake.emit('update-available', { version: '2.0.0' })
        return available()
      },
      downloadUpdate: async (fake) => {
        fake.emit('download-progress', {
          percent: 37.5,
          bytesPerSecond: 2048,
          transferred: 3,
          total: 8,
        })
        fake.emit('update-downloaded', { version: '2.0.0' })
        return ['FluxPlayer-2.0.0-Setup.exe']
      },
      quitAndInstall: () => order.push('quitAndInstall'),
    })
    const statuses: UpdaterStatus[] = []
    const controller = new UpdaterController({
      adapter,
      prepareForInstall: async () => {
        await Promise.resolve()
        order.push('prepareForInstall')
      },
      onStateChange: (state) => statuses.push(state.status),
    })

    expect(adapter.checkCalls).toBe(0)
    expect(adapter.autoDownload).toBe(false)
    expect(adapter.autoInstallOnAppQuit).toBe(false)
    expect(controller.getState()).toMatchObject({
      status: 'idle',
      currentVersion: '1.0.0',
      disabledReason: null,
    })

    await expect(controller.check()).resolves.toMatchObject({
      ok: true,
      state: { status: 'available', availableVersion: '2.0.0' },
    })
    await expect(controller.download()).resolves.toMatchObject({
      ok: true,
      state: { status: 'downloaded', availableVersion: '2.0.0' },
    })
    await expect(controller.install()).resolves.toMatchObject({
      ok: true,
      state: { status: 'downloaded' },
    })

    expect(statuses).toEqual(['checking', 'available', 'downloading', 'progress', 'downloaded'])
    expect(order).toEqual(['prepareForInstall', 'quitAndInstall'])
    expect(adapter.installCalls).toBe(1)
    await expect(controller.install()).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPDATER_INSTALL_ALREADY_REQUESTED' },
    })
  })

  it('finishes a check with not-available and clears update metadata', async () => {
    const adapter = new FakeUpdaterAdapter({ currentVersion: '2.0.0' })
    const controller = new UpdaterController({ adapter, prepareForInstall: vi.fn() })

    await expect(controller.check()).resolves.toEqual({
      ok: true,
      state: {
        status: 'not-available',
        currentVersion: '2.0.0',
        availableVersion: null,
        progress: null,
        error: null,
        disabledReason: null,
      },
    })
    expect(adapter.downloadCalls).toBe(0)
  })

  it('publishes normalized download progress and returns immutable snapshots', async () => {
    const adapter = new FakeUpdaterAdapter({
      checkForUpdates: () => available('3.0.0'),
      downloadUpdate: (fake) => {
        fake.emit('download-progress', {
          percent: 120,
          bytesPerSecond: -1,
          transferred: Number.NaN,
          total: 900,
        })
        return []
      },
    })
    const snapshots: Array<ReturnType<UpdaterController['getState']>> = []
    const controller = new UpdaterController({
      adapter,
      prepareForInstall: vi.fn(),
      onStateChange: (state) => snapshots.push(state),
    })

    await controller.check()
    await controller.download()

    const progress = snapshots.find((state) => state.status === 'progress')
    expect(progress?.progress).toEqual({
      percent: 100,
      bytesPerSecond: 0,
      transferred: 0,
      total: 900,
    })
    if (progress?.progress) progress.progress.percent = 1
    expect(controller.getState()).toMatchObject({ status: 'downloaded', progress: null })
  })

  it('normalizes check and download exceptions into stable error states', async () => {
    const checkError = Object.assign(new Error('release endpoint unavailable'), {
      code: 'ERR_UPDATER_NETWORK',
    })
    const checkingAdapter = new FakeUpdaterAdapter({
      checkForUpdates: async () => Promise.reject(checkError),
    })
    const checking = new UpdaterController({
      adapter: checkingAdapter,
      prepareForInstall: vi.fn(),
    })

    await expect(checking.check()).resolves.toMatchObject({
      ok: false,
      state: { status: 'error' },
      error: { code: 'ERR_UPDATER_NETWORK', message: 'release endpoint unavailable' },
    })

    const downloadAdapter = new FakeUpdaterAdapter({
      checkForUpdates: () => available(),
      downloadUpdate: async (fake) => {
        fake.emit('error', 'disk full')
        throw new Error('secondary rejection')
      },
    })
    const downloading = new UpdaterController({
      adapter: downloadAdapter,
      prepareForInstall: vi.fn(),
    })
    await downloading.check()

    await expect(downloading.download()).resolves.toMatchObject({
      ok: false,
      state: { status: 'error' },
      error: { code: 'UPDATER_DOWNLOAD_FAILED', message: 'disk full' },
    })
  })

  it('rejects duplicate in-flight commands without invoking the adapter twice', async () => {
    const checkResult = deferred<UpdaterCheckResult | null>()
    const adapter = new FakeUpdaterAdapter({ checkForUpdates: () => checkResult.promise })
    const controller = new UpdaterController({ adapter, prepareForInstall: vi.fn() })

    const first = controller.check()
    await expect(controller.check()).resolves.toMatchObject({
      ok: false,
      state: { status: 'checking' },
      error: {
        code: 'UPDATER_COMMAND_IN_PROGRESS',
        message: 'Cannot check while check is in progress.',
      },
    })
    await expect(controller.download()).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPDATER_COMMAND_IN_PROGRESS' },
    })
    expect(adapter.checkCalls).toBe(1)

    checkResult.resolve(available())
    await expect(first).resolves.toMatchObject({ ok: true, state: { status: 'available' } })

    const downloadResult = deferred<readonly string[]>()
    const secondAdapter = new FakeUpdaterAdapter({
      checkForUpdates: () => available(),
      downloadUpdate: () => downloadResult.promise,
    })
    const secondController = new UpdaterController({
      adapter: secondAdapter,
      prepareForInstall: vi.fn(),
    })
    await secondController.check()
    const firstDownload = secondController.download()
    await expect(secondController.download()).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPDATER_COMMAND_IN_PROGRESS' },
    })
    expect(secondAdapter.downloadCalls).toBe(1)
    downloadResult.resolve([])
    await expect(firstDownload).resolves.toMatchObject({ ok: true, state: { status: 'downloaded' } })
  })

  it('returns readable invalid-state errors without mutating the state', async () => {
    const adapter = new FakeUpdaterAdapter()
    const controller = new UpdaterController({ adapter, prepareForInstall: vi.fn() })

    await expect(controller.download()).resolves.toMatchObject({
      ok: false,
      state: { status: 'idle', error: null },
      error: {
        code: 'UPDATER_INVALID_STATE',
        message: 'Cannot download while updater status is "idle"; expected "available".',
      },
    })
    await expect(controller.install()).resolves.toMatchObject({
      ok: false,
      state: { status: 'idle', error: null },
      error: { code: 'UPDATER_INVALID_STATE' },
    })
    expect(adapter.downloadCalls).toBe(0)
    expect(adapter.installCalls).toBe(0)
  })

  it.each([
    ['development', { isDevelopment: true }],
    ['smoke', { isSmoke: true }],
    ['legacy', { isLegacy: true }],
  ] as const)('disables all commands in %s mode', async (reason, mode) => {
    const adapter = new FakeUpdaterAdapter()
    const controller = new UpdaterController({
      adapter,
      prepareForInstall: vi.fn(),
      mode,
    })

    expect(controller.getState()).toMatchObject({ status: 'idle', disabledReason: reason })
    await expect(controller.check()).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPDATER_DISABLED' },
    })
    await expect(controller.download()).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPDATER_DISABLED' },
    })
    await expect(controller.install()).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPDATER_DISABLED' },
    })
    expect(adapter.checkCalls).toBe(0)
    expect(adapter.downloadCalls).toBe(0)
    expect(adapter.installCalls).toBe(0)
  })

  it('removes every adapter listener on idempotent dispose and ignores late events', async () => {
    const pending = deferred<UpdaterCheckResult | null>()
    const adapter = new FakeUpdaterAdapter({ checkForUpdates: () => pending.promise })
    const changed = vi.fn()
    const controller = new UpdaterController({
      adapter,
      prepareForInstall: vi.fn(),
      onStateChange: changed,
    })
    const events: UpdaterEventName[] = [
      'checking-for-update',
      'update-available',
      'update-not-available',
      'download-progress',
      'update-downloaded',
      'error',
    ]
    expect(events.map((event) => adapter.listenerCount(event))).toEqual([1, 1, 1, 1, 1, 1])

    const check = controller.check()
    controller.dispose()
    controller.dispose()
    expect(events.map((event) => adapter.listenerCount(event))).toEqual([0, 0, 0, 0, 0, 0])

    adapter.emit('update-available', { version: '9.9.9' })
    pending.resolve(available('9.9.9'))
    await expect(check).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPDATER_DISPOSED' },
    })
    expect(controller.getState()).toMatchObject({ status: 'checking', availableVersion: null })
    await expect(controller.check()).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPDATER_DISPOSED' },
    })
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('awaits install cleanup and never invokes quitAndInstall when cleanup fails', async () => {
    const adapter = new FakeUpdaterAdapter({ checkForUpdates: () => available() })
    const cleanup = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('wallpaper detach failed'))
      .mockResolvedValueOnce(undefined)
    const controller = await reachDownloaded(adapter, cleanup)

    await expect(controller.install()).resolves.toMatchObject({
      ok: false,
      state: { status: 'error', availableVersion: '2.0.0' },
      error: {
        code: 'UPDATER_PREPARE_INSTALL_FAILED',
        message: 'wallpaper detach failed',
      },
    })
    expect(cleanup).toHaveBeenCalledOnce()
    expect(adapter.installCalls).toBe(0)

    await expect(controller.install()).resolves.toMatchObject({
      ok: true,
      state: { status: 'downloaded', error: null },
    })
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(adapter.installCalls).toBe(1)
  })

  it('returns a synchronous quitAndInstall error and allows retrying the downloaded update', async () => {
    const cleanup = vi.fn()
    let failInstall = true
    const adapter = new FakeUpdaterAdapter({
      checkForUpdates: () => available(),
      quitAndInstall: (fake) => {
        if (failInstall) {
          failInstall = false
          fake.emit('error', { code: 'ERR_UPDATER_INSTALLER_MISSING', message: 'installer missing' })
        }
      },
    })
    const controller = await reachDownloaded(adapter, cleanup)

    await expect(controller.install()).resolves.toMatchObject({
      ok: false,
      state: {
        status: 'error',
        availableVersion: '2.0.0',
        error: { code: 'ERR_UPDATER_INSTALLER_MISSING', message: 'installer missing' },
      },
      error: { code: 'ERR_UPDATER_INSTALLER_MISSING', message: 'installer missing' },
    })
    expect(adapter.installCalls).toBe(1)

    await expect(controller.install()).resolves.toMatchObject({
      ok: true,
      state: { status: 'downloaded', error: null },
    })
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(adapter.installCalls).toBe(2)
  })

  it('blocks a duplicate install while asynchronous cleanup is still running', async () => {
    const cleanup = deferred<void>()
    const adapter = new FakeUpdaterAdapter({ checkForUpdates: () => available() })
    const controller = await reachDownloaded(adapter, () => cleanup.promise)

    const firstInstall = controller.install()
    await expect(controller.install()).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPDATER_COMMAND_IN_PROGRESS' },
    })
    expect(adapter.installCalls).toBe(0)

    cleanup.resolve()
    await expect(firstInstall).resolves.toMatchObject({ ok: true })
    expect(adapter.installCalls).toBe(1)
  })
})

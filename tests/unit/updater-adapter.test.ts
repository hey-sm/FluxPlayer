import { describe, expect, it, vi } from 'vitest'
import { UPDATER_PROVIDER } from '@shared/updater-contract'
import {
  ElectronUpdaterAdapter,
  type ElectronUpdaterPort,
} from '../../src/main/updater/electron-updater-adapter'

describe('ElectronUpdaterAdapter', () => {
  it('pins the GitHub provider and disables implicit download/install without loading Electron', async () => {
    const setFeedURL = vi.fn()
    const checkForUpdates = vi.fn(async () => null)
    const downloadUpdate = vi.fn(async () => ['setup.exe'])
    const quitAndInstall = vi.fn()
    const on = vi.fn()
    const removeListener = vi.fn()
    const port: ElectronUpdaterPort = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      currentVersion: { version: '2.0.0-alpha.1' },
      setFeedURL,
      checkForUpdates,
      downloadUpdate,
      quitAndInstall,
      on,
      removeListener,
    }

    const adapter = new ElectronUpdaterAdapter(port)

    expect(adapter.currentVersion).toBe('2.0.0-alpha.1')
    expect(port.autoDownload).toBe(false)
    expect(port.autoInstallOnAppQuit).toBe(false)
    expect(setFeedURL).toHaveBeenCalledWith(UPDATER_PROVIDER)
    await expect(adapter.checkForUpdates()).resolves.toBeNull()
    await expect(adapter.downloadUpdate()).resolves.toEqual(['setup.exe'])
    adapter.quitAndInstall()
    expect(quitAndInstall).toHaveBeenCalledOnce()
  })
})

import { create } from 'zustand'
import type { MusicAuthResult } from '@shared/music-contract'
import type { ProviderId } from '@shared/models'
import { musicClient, musicErrorMessage } from '../api'
import { createQQPollingController, type QQPollingController } from '../auth/qq-polling'

type ProviderAuthState = MusicAuthResult | null
interface AuthState {
  netease: ProviderAuthState
  qq: ProviderAuthState
  neteaseBusy: boolean
  qqBusy: boolean
  message: string
  refreshAll(): Promise<void>
  refreshNetease(): Promise<void>
  refreshQQ(): Promise<void>
  loginNetease(): Promise<void>
  logoutNetease(): Promise<void>
  loginQQ(): Promise<void>
  logoutQQ(): Promise<void>
  startQQPolling(): () => void
  stopQQPolling(): void
}

let qqPollingController: QQPollingController | null = null
let qqStatusEpoch = 0
const polling = (): QQPollingController =>
  (qqPollingController ??= createQQPollingController({ poll: () => useAuth.getState().refreshQQ() }))
async function status(provider: ProviderId): Promise<ProviderAuthState> {
  const value = await musicClient.getAuthStatus(provider)
  return value.provider === provider ? value : null
}

export const useAuth = create<AuthState>((set, get) => ({
  netease: null,
  qq: null,
  neteaseBusy: false,
  qqBusy: false,
  message: '',
  async refreshAll() {
    await Promise.all([get().refreshNetease(), get().refreshQQ()])
  },
  async refreshNetease() {
    try {
      set({ netease: await status('netease') })
    } catch {
      set({ netease: null })
    }
  },
  async refreshQQ() {
    const epoch = qqStatusEpoch
    try {
      const qq = await status('qq')
      if (epoch !== qqStatusEpoch) return
      set({ qq })
      if (qq?.loggedIn) polling().start()
      else polling().stop()
    } catch {
      if (epoch === qqStatusEpoch) set({ qq: null })
    }
  },
  async loginNetease() {
    set({ neteaseBusy: true, message: '' })
    try {
      const netease = await musicClient.login('netease')
      set({ netease, message: netease.loggedIn ? '' : '登录未生效' })
    } catch (error) {
      set({ message: musicErrorMessage(error, '登录异常') })
    } finally {
      set({ neteaseBusy: false })
    }
  },
  async logoutNetease() {
    set({ neteaseBusy: true })
    try {
      await musicClient.logout('netease')
    } catch {
      // The main process owns credentials; clear observable local state even if logout fails.
    } finally {
      set({ netease: null, neteaseBusy: false, message: '' })
    }
  },
  async loginQQ() {
    qqStatusEpoch += 1
    set({ qqBusy: true, message: '' })
    try {
      const qq = await musicClient.login('qq')
      set({
        qq,
        message: !qq.loggedIn
          ? '登录未生效'
          : qq.partial || qq.playbackKeyReady === false
            ? '播放授权不完整，部分歌曲将自动换源'
            : '',
      })
      if (qq.loggedIn) polling().start()
    } catch (error) {
      set({ message: musicErrorMessage(error, '登录异常') })
    } finally {
      set({ qqBusy: false })
    }
  },
  async logoutQQ() {
    qqStatusEpoch += 1
    polling().stop()
    set({ qqBusy: true })
    try {
      await musicClient.logout('qq')
    } catch {
      // The main process owns credentials; clear observable local state even if logout fails.
    } finally {
      set({ qq: null, qqBusy: false, message: '' })
    }
  },
  startQQPolling() {
    const controller = polling()
    if (get().qq?.loggedIn) controller.start()
    else controller.stop()
    return () => {
      qqStatusEpoch += 1
      controller.stop()
    }
  },
  stopQQPolling() {
    qqStatusEpoch += 1
    polling().stop()
  },
}))

import { create } from 'zustand'
import type { MusicAuthResult } from '@shared/music-contract'
import type { ProviderId } from '@shared/models'
import { musicClient, musicErrorMessage } from '../api'
import { createQQPollingController, type QQPollingController } from '../auth/qq-polling'
import { showToast } from './toast'

type ProviderAuthState = MusicAuthResult | null
interface AuthState {
  netease: ProviderAuthState
  qq: ProviderAuthState
  neteaseBusy: boolean
  qqBusy: boolean
  validateOnStartup(): Promise<void>
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
let startupValidation: Promise<void> | null = null
const polling = (): QQPollingController =>
  (qqPollingController ??= createQQPollingController({ poll: () => useAuth.getState().refreshQQ() }))
async function status(provider: ProviderId): Promise<ProviderAuthState> {
  const value = await musicClient.getAuthStatus(provider)
  return value.provider === provider ? value : null
}

function credentialInvalid(state: ProviderAuthState): boolean {
  return state?.credentialInvalidated === true
}

const providerName: Readonly<Record<ProviderId, string>> = {
  netease: '网易云音乐',
  qq: 'QQ 音乐',
}

export const useAuth = create<AuthState>((set, get) => ({
  netease: null,
  qq: null,
  neteaseBusy: false,
  qqBusy: false,
  validateOnStartup() {
    if (startupValidation) return startupValidation
    startupValidation = (async () => {
      const [neteaseResult, qqResult] = await Promise.allSettled([status('netease'), status('qq')])
      const netease = neteaseResult.status === 'fulfilled' ? neteaseResult.value : null
      const qq = qqResult.status === 'fulfilled' ? qqResult.value : null
      set({ netease, qq })
      if (qq?.loggedIn) polling().start()
      else polling().stop()

      const invalidProviders = (
        [
          ['netease', netease],
          ['qq', qq],
        ] as const
      ).filter(([, auth]) => credentialInvalid(auth))
      await Promise.allSettled(invalidProviders.map(([provider]) => musicClient.logout(provider)))
      for (const [provider] of invalidProviders) {
        showToast(`${providerName[provider]}登录已失效，请重新登录`, {
          title: '账号登录失效',
          tone: 'warning',
          duration: 8000,
        })
      }
    })()
    return startupValidation
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
    set({ neteaseBusy: true })
    try {
      const netease = await musicClient.login('netease')
      set({ netease })
      if (!netease.loggedIn) {
        showToast('登录未生效，请重试', { title: '网易云音乐登录', tone: 'warning' })
      }
    } catch (error) {
      showToast(musicErrorMessage(error, '登录异常'), {
        title: '网易云音乐登录失败',
        tone: 'error',
      })
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
      set({ netease: null, neteaseBusy: false })
    }
  },
  async loginQQ() {
    qqStatusEpoch += 1
    set({ qqBusy: true })
    try {
      const qq = await musicClient.login('qq')
      set({ qq })
      if (!qq.loggedIn) {
        showToast('登录未生效，请重试', { title: 'QQ 音乐登录', tone: 'warning' })
      } else if (qq.partial || qq.playbackKeyReady === false) {
        showToast('播放授权不完整，部分歌曲可能无法播放', {
          title: 'QQ 音乐授权提示',
          tone: 'warning',
          duration: 8000,
        })
      }
      if (qq.loggedIn) polling().start()
    } catch (error) {
      showToast(musicErrorMessage(error, '登录异常'), {
        title: 'QQ 音乐登录失败',
        tone: 'error',
      })
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
      set({ qq: null, qqBusy: false })
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

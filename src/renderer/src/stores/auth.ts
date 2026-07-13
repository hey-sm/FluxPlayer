import { create } from 'zustand'
import type { NeteaseLoginInfo, QQLoginInfo } from '@shared/models'
import { apiJson } from '../api'
import { createQQPollingController, type QQPollingController } from '../auth/qq-polling'

/**
 * 登录态 store —— 网易云 + QQ 两条独立链路。
 * cookie 走 preload 的 openXxxLogin()（返回拼好的 header 字符串），
 * 再 POST 给本地 server 落地，最后拉状态端点。API 路径与旧版兼容。
 */

type NeteaseState = NeteaseLoginInfo | null
type QQState = QQLoginInfo | null

interface AuthState {
  netease: NeteaseState
  qq: QQState
  /** 各自的进行中标记，UI 用来禁用按钮 / 显示 loading */
  neteaseBusy: boolean
  qqBusy: boolean
  /** 最近一次操作的提示（换源提示等） */
  message: string

  /** 启动时并发拉两个状态 */
  refreshAll(): Promise<void>
  refreshNetease(): Promise<void>
  refreshQQ(): Promise<void>

  loginNetease(): Promise<void>
  logoutNetease(): Promise<void>
  loginQQ(): Promise<void>
  logoutQQ(): Promise<void>

  /** 启动 QQ 登录态轮询；返回值用于 App unmount 时清理。 */
  startQQPolling(): () => void
  stopQQPolling(): void
}

const JSON_HEADERS: RequestInit = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
}

function bust(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}`
}

let qqPollingController: QQPollingController | null = null
let qqStatusEpoch = 0

function getQQPollingController(): QQPollingController {
  qqPollingController ??= createQQPollingController({
    poll: () => useAuth.getState().refreshQQ(),
  })
  return qqPollingController
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
      const info = await apiJson<NeteaseLoginInfo>(bust('/api/login/status'))
      set({ netease: info && typeof info.loggedIn === 'boolean' ? info : null })
    } catch {
      set({ netease: null })
    }
  },

  async refreshQQ() {
    const statusEpoch = qqStatusEpoch
    try {
      const info = await apiJson<QQLoginInfo>(bust('/api/qq/login/status'))
      if (statusEpoch !== qqStatusEpoch) return

      const qq = info && typeof info.loggedIn === 'boolean' ? info : null
      set({ qq })
      if (qq?.loggedIn) getQQPollingController().start()
      else getQQPollingController().stop()
    } catch {
      if (statusEpoch === qqStatusEpoch) set({ qq: null })
    }
  },

  async loginNetease() {
    const desktop = window.fluxDesktop
    if (!desktop) return
    set({ neteaseBusy: true, message: '' })
    try {
      const result = await desktop.openNeteaseLogin()
      if (result.cancelled) {
        set({ message: '已取消登录' })
        return
      }
      if (!result.ok || !result.cookie) {
        set({ message: result.message || result.error || '登录失败' })
        return
      }
      const info = await apiJson<NeteaseLoginInfo & { error?: string; message?: string }>(
        '/api/login/cookie',
        {
          ...JSON_HEADERS,
          body: JSON.stringify({ cookie: result.cookie }),
        },
      )
      if (!info || !info.loggedIn) {
        set({ message: info?.message || info?.error || '登录未生效' })
        await get().refreshNetease()
        return
      }
      set({ netease: info, message: '' })
      await get().refreshNetease()
    } catch (e: any) {
      set({ message: e?.message || '登录异常' })
    } finally {
      set({ neteaseBusy: false })
    }
  },

  async logoutNetease() {
    set({ neteaseBusy: true })
    try {
      await apiJson('/api/logout', { method: 'POST' }).catch(() => {})
      await window.fluxDesktop?.clearNeteaseLogin().catch(() => {})
    } finally {
      set({ netease: null, neteaseBusy: false, message: '' })
    }
  },

  async loginQQ() {
    const desktop = window.fluxDesktop
    if (!desktop) return
    qqStatusEpoch += 1
    set({ qqBusy: true, message: '' })
    try {
      const result = await desktop.openQQLogin()
      if (result.cancelled) {
        set({ message: '已取消登录' })
        return
      }
      if (!result.ok || !result.cookie) {
        set({ message: result.message || result.error || '登录失败' })
        return
      }
      const info = await apiJson<QQLoginInfo & { error?: string; message?: string }>('/api/qq/login/cookie', {
        ...JSON_HEADERS,
        body: JSON.stringify({ cookie: result.cookie }),
      })
      if (!info || !info.loggedIn) {
        set({ message: info?.message || info?.error || '登录未生效' })
        await get().refreshQQ()
        return
      }
      // QQ 特有：播放授权不完整提示（result.partial 或 playbackKeyReady===false）
      const partial = result.partial || info.playbackKeyReady === false
      set({
        qq: info,
        message: partial ? '播放授权不完整，部分歌曲将自动换源' : '',
      })
      getQQPollingController().start()
      await get().refreshQQ()
    } catch (e: any) {
      set({ message: e?.message || '登录异常' })
    } finally {
      set({ qqBusy: false })
    }
  },

  async logoutQQ() {
    qqStatusEpoch += 1
    getQQPollingController().stop()
    set({ qqBusy: true })
    try {
      await apiJson('/api/qq/logout', { method: 'POST' }).catch(() => {})
      await window.fluxDesktop?.clearQQLogin().catch(() => {})
    } finally {
      set({ qq: null, qqBusy: false, message: '' })
    }
  },

  startQQPolling() {
    const controller = getQQPollingController()
    if (!get().qq?.loggedIn) {
      qqStatusEpoch += 1
      controller.stop()
    } else {
      controller.start()
    }

    return () => {
      qqStatusEpoch += 1
      controller.stop()
    }
  },

  stopQQPolling() {
    qqStatusEpoch += 1
    getQQPollingController().stop()
  },
}))

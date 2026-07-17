import { BrowserWindow, session, shell } from 'electron'
import type { LoginWindowResult } from '@shared/ipc-contract'

/**
 * 音乐平台登录窗口：打开真实官网登录页，轮询 partition 内 cookie 直到拿到登录票据。
 * 移植自旧 desktop/main.js。有意去掉了旧版 executeJavaScript 自动点击登录按钮的逻辑
 * （脆弱且依赖页面结构），用户自行点击页面上的登录入口。
 */

const NETEASE_LOGIN_PARTITION = 'persist:fluxplayer-netease-login'
const NETEASE_LOGIN_URL = 'https://music.163.com/#/login'
const QQ_LOGIN_PARTITION = 'persist:fluxplayer-qqmusic-login'
const QQ_LOGIN_URL = 'https://y.qq.com/n/ryqq/profile'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

const QQ_LOGIN_COOKIE_PRIORITY = [
  'uin',
  'qqmusic_uin',
  'wxuin',
  'login_type',
  'qm_keyst',
  'qqmusic_key',
  'p_skey',
  'skey',
  'psrf_qqopenid',
  'psrf_qqunionid',
  'psrf_qqaccess_token',
  'psrf_qqrefresh_token',
  'wxopenid',
  'wxunionid',
  'wxrefresh_token',
  'wxskey',
  'p_uin',
  'ptcz',
  'RK',
]
const NETEASE_LOGIN_COOKIE_PRIORITY = [
  'MUSIC_U',
  '__csrf',
  'NMTID',
  'MUSIC_A',
  '__remember_me',
  '_ntes_nuid',
  '_ntes_nnid',
  'WEVNSM',
  'WNMCID',
  'JSESSIONID-WYYY',
]

function parseCookieHeader(cookieText: string): Record<string, string> {
  const out: Record<string, string> = {}
  String(cookieText || '')
    .split(';')
    .forEach((part) => {
      const raw = String(part || '').trim()
      if (!raw) return
      const idx = raw.indexOf('=')
      if (idx <= 0) return
      out[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim()
    })
  return out
}

function qqCookieHasLogin(cookieText: string): boolean {
  const obj = parseCookieHeader(cookieText)
  const rawUin =
    Number(obj.login_type) === 2
      ? obj.wxuin || obj.uin || obj.p_uin || ''
      : obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || ''
  const uin = String(rawUin).replace(/\D/g, '')
  const musicKey =
    obj.qm_keyst ||
    obj.qqmusic_key ||
    obj.music_key ||
    obj.p_skey ||
    obj.skey ||
    obj.psrf_qqaccess_token ||
    obj.psrf_qqrefresh_token ||
    obj.wxrefresh_token ||
    obj.wxskey ||
    ''
  return !!(uin && musicKey)
}

function qqCookieHasPlaybackLogin(cookieText: string): boolean {
  const obj = parseCookieHeader(cookieText)
  const rawUin =
    Number(obj.login_type) === 2
      ? obj.wxuin || obj.uin || obj.p_uin || ''
      : obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || ''
  const uin = String(rawUin).replace(/\D/g, '')
  const playbackKey = obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || ''
  return !!(uin && playbackKey)
}

function neteaseCookieHasLogin(cookieText: string): boolean {
  return !!parseCookieHeader(cookieText).MUSIC_U
}

function isQQCookieDomain(domain: string | undefined): boolean {
  const normalized = String(domain || '')
    .replace(/^\./, '')
    .toLowerCase()
  return normalized === 'qq.com' || normalized.endsWith('.qq.com') || normalized.endsWith('qqmusic.qq.com')
}

function isNeteaseCookieDomain(domain: string | undefined): boolean {
  const normalized = String(domain || '')
    .replace(/^\./, '')
    .toLowerCase()
  return (
    normalized === '163.com' ||
    normalized.endsWith('.163.com') ||
    normalized === 'music.163.com' ||
    normalized.endsWith('.music.163.com') ||
    normalized === 'netease.com' ||
    normalized.endsWith('.netease.com')
  )
}

function buildCookieHeaderFor(
  cookies: Electron.Cookie[],
  isAllowedDomain: (domain: string | undefined) => boolean,
  priority: string[],
): string {
  const picked = new Map<string, string>()
  ;(cookies || []).forEach((cookie) => {
    if (!cookie || !cookie.name || !isAllowedDomain(cookie.domain)) return
    picked.set(cookie.name, cookie.value || '')
  })
  const ordered: Array<[string, string]> = []
  priority.forEach((name) => {
    if (picked.has(name)) {
      ordered.push([name, picked.get(name) || ''])
      picked.delete(name)
    }
  })
  picked.forEach((value, name) => ordered.push([name, value]))
  return ordered
    .filter(([name, value]) => name && value != null && String(value) !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

async function readQQLoginCookieHeader(cookieSession: Electron.Session): Promise<string> {
  const cookies = await cookieSession.cookies.get({})
  return buildCookieHeaderFor(cookies, isQQCookieDomain, QQ_LOGIN_COOKIE_PRIORITY)
}

async function readNeteaseLoginCookieHeader(cookieSession: Electron.Session): Promise<string> {
  const cookies = await cookieSession.cookies.get({})
  return buildCookieHeaderFor(cookies, isNeteaseCookieDomain, NETEASE_LOGIN_COOKIE_PRIORITY)
}

export async function openNeteaseMusicLoginWindow(owner?: BrowserWindow | null): Promise<LoginWindowResult> {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION)
  const initialCookie = await readNeteaseLoginCookieHeader(cookieSession)
  if (neteaseCookieHasLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true }

  return new Promise((resolve) => {
    let settled = false
    let pollTimer: NodeJS.Timeout | null = null

    const loginWindow = new BrowserWindow({
      width: 940,
      height: 760,
      minWidth: 780,
      minHeight: 580,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: '网易云音乐登录',
      backgroundColor: '#111111',
      webPreferences: {
        partition: NETEASE_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    const finish = (result: LoginWindowResult) => {
      if (settled) return
      settled = true
      if (pollTimer) clearInterval(pollTimer)
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
      resolve(result)
    }

    const checkCookies = async () => {
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession)
        if (neteaseCookieHasLogin(cookie)) finish({ ok: true, cookie })
      } catch (error: unknown) {
        console.warn('Netease login cookie check failed:', errorMessage(error, 'unknown error'))
      }
    }

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\/([^/]+\.)?(163|music\.163|netease)\.com/i.test(url)) {
        loginWindow
          .loadURL(url)
          .catch((e) => console.warn('Netease login popup navigation failed:', e.message))
      } else if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => {})
      }
      return { action: 'deny' }
    })

    loginWindow.webContents.on('did-finish-load', checkCookies)
    loginWindow.on('ready-to-show', () => loginWindow.show())
    loginWindow.on('closed', async () => {
      if (settled) return
      if (pollTimer) clearInterval(pollTimer)
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession)
        resolve(
          neteaseCookieHasLogin(cookie)
            ? { ok: true, cookie }
            : { ok: false, cancelled: true, message: '网易云登录窗口已关闭' },
        )
      } catch (error: unknown) {
        resolve({ ok: false, error: errorMessage(error, '网易云登录窗口已关闭') })
      }
    })

    pollTimer = setInterval(checkCookies, 1200)
    loginWindow.loadURL(NETEASE_LOGIN_URL).catch((e) => finish({ ok: false, error: e.message }))
  })
}

export async function openQQMusicLoginWindow(owner?: BrowserWindow | null): Promise<LoginWindowResult> {
  const cookieSession = session.fromPartition(QQ_LOGIN_PARTITION)
  const initialCookie = await readQQLoginCookieHeader(cookieSession)
  if (qqCookieHasPlaybackLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true }

  return new Promise((resolve) => {
    let settled = false
    let pollTimer: NodeJS.Timeout | null = null
    let warmupStarted = false

    const loginWindow = new BrowserWindow({
      width: 900,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: 'QQ 音乐登录',
      backgroundColor: '#111111',
      webPreferences: {
        partition: QQ_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    const finish = (result: LoginWindowResult) => {
      if (settled) return
      settled = true
      if (pollTimer) clearInterval(pollTimer)
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
      resolve(result)
    }

    const checkCookies = async () => {
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession)
        if (qqCookieHasPlaybackLogin(cookie)) {
          finish({ ok: true, cookie })
        } else if (qqCookieHasLogin(cookie) && !warmupStarted) {
          // 已有网页登录态但缺播放授权：导航到播放器页触发 qm_keyst 下发
          warmupStarted = true
          setTimeout(() => {
            if (!settled && loginWindow && !loginWindow.isDestroyed()) {
              loginWindow
                .loadURL('https://y.qq.com/n/ryqq/player')
                .catch((e) => console.warn('QQ login warmup navigation failed:', e.message))
            }
          }, 900)
        }
      } catch (error: unknown) {
        console.warn('QQ login cookie check failed:', errorMessage(error, 'unknown error'))
      }
    }

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('QQ login popup navigation failed:', e.message))
      } else {
        shell.openExternal(url).catch(() => {})
      }
      return { action: 'deny' }
    })

    loginWindow.webContents.on('did-finish-load', checkCookies)
    loginWindow.on('ready-to-show', () => loginWindow.show())
    loginWindow.on('closed', async () => {
      if (settled) return
      if (pollTimer) clearInterval(pollTimer)
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession)
        resolve(
          qqCookieHasLogin(cookie)
            ? { ok: true, cookie, partial: !qqCookieHasPlaybackLogin(cookie) }
            : { ok: false, cancelled: true, message: 'QQ 登录窗口已关闭' },
        )
      } catch (error: unknown) {
        resolve({ ok: false, error: errorMessage(error, 'QQ 登录窗口已关闭') })
      }
    })

    pollTimer = setInterval(checkCookies, 1200)
    loginWindow.loadURL(QQ_LOGIN_URL).catch((e) => finish({ ok: false, error: e.message }))
  })
}

export async function clearQQMusicLoginSession(): Promise<{ ok: boolean }> {
  const cookieSession = session.fromPartition(QQ_LOGIN_PARTITION)
  await cookieSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'] })
  return { ok: true }
}

export async function clearNeteaseMusicLoginSession(): Promise<{ ok: boolean }> {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION)
  await cookieSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'] })
  return { ok: true }
}

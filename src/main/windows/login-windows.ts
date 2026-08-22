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

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl)
  } catch {
    return null
  }
}

/**
 * 只有 http(s) 能交给系统浏览器。把其它 scheme 转给 shell.openExternal 等于把任意 URI handler
 * （ms-msdt:、search-ms:、file:、smb: …）暴露给登录窗口里的远程页面。
 */
function openExternalHttpUrl(rawUrl: string): void {
  const target = parseUrl(rawUrl)
  if (target && (target.protocol === 'https:' || target.protocol === 'http:')) {
    void shell.openExternal(target.href).catch(() => {
      // 交给系统失败不影响登录流程。
    })
  }
}

/**
 * 目标是否属于「可以留在登录窗口内」的站内地址：必须是 http(s)，且主机命中 provider 自有域。
 */
function isInSiteLoginUrl(rawUrl: string, isAllowedDomain: (domain: string | undefined) => boolean): boolean {
  const target = parseUrl(rawUrl)
  if (!target) return false
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return false
  return isAllowedDomain(target.hostname)
}

/**
 * 登录窗口是全项目唯一加载远程第三方页面的地方，同时持有 provider 的 cookie partition，
 * 且没有地址栏——用户无法看出自己已被导到别处。导航策略因此收紧为三条：
 *
 * 1. 非 http(s) 目标一律拒绝，绝不下发给操作系统。
 * 2. provider 自有域（复用 cookie 域判定）在窗口内放行，登录流程要在窗口里走完。
 * 3. 其余 http(s) 目标不得进入本窗口，改用系统浏览器打开（帮助、协议、客服等外链）。
 *
 * 被拦的目标都会打日志：登录流程若因某个第三方鉴权域被拦而中断，看日志即可定位补白名单。
 */
function applyLoginNavigationPolicy(
  loginWindow: BrowserWindow,
  isAllowedDomain: (domain: string | undefined) => boolean,
  label: string,
): void {
  const isInSite = (rawUrl: string): boolean => isInSiteLoginUrl(rawUrl, isAllowedDomain)

  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInSite(url)) {
      loginWindow
        .loadURL(url)
        .catch((e) => console.warn(`${label} login popup navigation failed:`, e.message))
    } else {
      openExternalHttpUrl(url)
    }
    return { action: 'deny' }
  })

  loginWindow.webContents.on('will-navigate', (event, url) => {
    if (isInSite(url)) return
    event.preventDefault()
    console.warn(`${label} login navigation blocked:`, url)
    openExternalHttpUrl(url)
  })

  loginWindow.webContents.on('will-redirect', (event, url) => {
    if (isInSite(url)) return
    event.preventDefault()
    console.warn(`${label} login redirect blocked:`, url)
  })
}

/** 导航策略的纯函数出口，供边界测试直接断言。 */
export const loginNavigationPolicyInternals = {
  isInSiteLoginUrl,
  isQQCookieDomain,
  isNeteaseCookieDomain,
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

    applyLoginNavigationPolicy(loginWindow, isNeteaseCookieDomain, 'Netease')

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

    applyLoginNavigationPolicy(loginWindow, isQQCookieDomain, 'QQ')

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

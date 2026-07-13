import { parseCookieString, serializeCookieObject } from '../../util/cookies'

/**
 * QQ 登录会话：cookie 的解析与派生（uin / musicKey / playbackKey / 昵称 / 头像）。
 * 收敛自旧 server.js 的 qqCookie* 六件套，行为保持一致。
 * login_type=2 表示微信登录，uin 取 wxuin。
 */

export function normalizeQQUin(raw: unknown): string {
  const digits = String(raw || '').replace(/\D/g, '')
  return digits.replace(/^0+/, '') || digits
}

export function decodeQQCookieValue(value: unknown): string {
  try {
    return decodeURIComponent(String(value || '').replace(/\+/g, '%20')).trim()
  } catch {
    return String(value || '').trim()
  }
}

export class QQSession {
  readonly obj: Record<string, string>

  constructor(cookieText: string) {
    this.obj = parseCookieString(cookieText)
  }

  get uin(): string {
    const obj = this.obj
    const raw =
      Number(obj.login_type) === 2
        ? obj.wxuin || obj.uin || obj.p_uin
        : obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin
    return normalizeQQUin(raw)
  }

  /** 网页登录票据（能标识登录，但不一定能拉播放地址） */
  get musicKey(): string {
    const obj = this.obj
    return (
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
    )
  }

  /** 播放授权票据（获取播放地址所需） */
  get playbackKey(): string {
    const obj = this.obj
    return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || ''
  }

  get loggedIn(): boolean {
    return !!(this.uin && this.musicKey)
  }

  get playbackReady(): boolean {
    return !!(this.uin && this.playbackKey)
  }

  nickname(): string {
    const obj = this.obj
    const uin = this.uin
    const padded = uin ? '0' + uin : ''
    const keys = [
      uin && 'ptnick_' + uin,
      padded && 'ptnick_' + padded,
      'ptnick',
      'nick',
      'nickname',
      'qq_nickname',
    ].filter(Boolean) as string[]
    for (const key of keys) {
      if (obj[key]) {
        const nick = decodeQQCookieValue(obj[key])
        if (nick) return nick
      }
    }
    const ptnickKey = Object.keys(obj).find((key) => /^ptnick_/i.test(key) && obj[key])
    return ptnickKey ? decodeQQCookieValue(obj[ptnickKey]) : ''
  }

  avatar(): string {
    const obj = this.obj
    const direct = obj.qqmusic_avatar || obj.avatar || obj.avatarUrl || obj.headpic || ''
    if (direct) return decodeQQCookieValue(direct)
    const uin = this.uin
    return uin ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(uin)}&s=100` : ''
  }
}

/** 规范化用户粘贴/登录窗口回填的 cookie 文本 */
export function normalizeQQCookieInput(cookieText: unknown): string {
  const obj = parseCookieString(cookieText)
  if (Number(obj.login_type) === 2 && obj.wxuin && !obj.uin) obj.uin = obj.wxuin
  if (!obj.uin && (obj.qqmusic_uin || obj.p_uin)) obj.uin = obj.qqmusic_uin || obj.p_uin
  if (obj.uin) obj.uin = normalizeQQUin(obj.uin)
  return serializeCookieObject(obj)
}

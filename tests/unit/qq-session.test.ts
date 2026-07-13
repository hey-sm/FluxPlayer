import { describe, expect, it } from 'vitest'
import { QQSession, normalizeQQCookieInput, normalizeQQUin } from '@server/providers/qq/session'

describe('normalizeQQUin', () => {
  it('去除非数字与前导零（o0123456 → 123456）', () => {
    expect(normalizeQQUin('o0123456')).toBe('123456')
    expect(normalizeQQUin('123456')).toBe('123456')
    expect(normalizeQQUin('')).toBe('')
  })
})

describe('QQSession', () => {
  it('QQ 登录：uin + qm_keyst → loggedIn 且 playbackReady', () => {
    const s = new QQSession('uin=o0123; qm_keyst=KEY; skey=S')
    expect(s.uin).toBe('123')
    expect(s.musicKey).toBe('KEY')
    expect(s.playbackKey).toBe('KEY')
    expect(s.loggedIn).toBe(true)
    expect(s.playbackReady).toBe(true)
  })

  it('仅网页票据（p_skey）：loggedIn 但缺播放授权', () => {
    const s = new QQSession('uin=123; p_skey=WEB')
    expect(s.loggedIn).toBe(true)
    expect(s.playbackReady).toBe(false)
  })

  it('微信登录（login_type=2）取 wxuin，wxskey 可播', () => {
    const s = new QQSession('login_type=2; wxuin=999; wxskey=WX')
    expect(s.uin).toBe('999')
    expect(s.playbackKey).toBe('WX')
    expect(s.playbackReady).toBe(true)
  })

  it('空 cookie：未登录', () => {
    const s = new QQSession('')
    expect(s.loggedIn).toBe(false)
    expect(s.playbackReady).toBe(false)
  })

  it('昵称从 ptnick_<uin> 解码，头像回退 qlogo', () => {
    const s = new QQSession('uin=123; qm_keyst=K; ptnick_123=%E5%B0%8F%E6%98%8E')
    expect(s.nickname()).toBe('小明')
    expect(s.avatar()).toBe('https://q1.qlogo.cn/g?b=qq&nk=123&s=100')
  })
})

describe('normalizeQQCookieInput', () => {
  it('微信登录补 uin=wxuin', () => {
    const out = normalizeQQCookieInput('login_type=2; wxuin=999; wxskey=WX')
    expect(out).toContain('uin=999')
  })
  it('qqmusic_uin 兜底为 uin 并去前导零', () => {
    const out = normalizeQQCookieInput('qqmusic_uin=o0456; qm_keyst=K')
    expect(out).toContain('uin=456')
  })
})

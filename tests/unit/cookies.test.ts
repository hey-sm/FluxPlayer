import { describe, expect, it } from 'vitest'
import { normalizeCookieHeader, parseCookieString, serializeCookieObject } from '@server/util/cookies'

describe('normalizeCookieHeader', () => {
  it('字符串输入：去属性、去重、拼接', () => {
    const out = normalizeCookieHeader('MUSIC_U=abc; Path=/; Domain=.163.com; __csrf=xyz; MUSIC_U=abc')
    expect(out).toBe('MUSIC_U=abc; __csrf=xyz')
  })
  it('对象数组输入（Electron cookies.get 形状）', () => {
    const out = normalizeCookieHeader([
      { name: 'uin', value: '123' },
      { name: 'qm_keyst', value: 'K' },
    ])
    expect(out).toBe('uin=123; qm_keyst=K')
  })
  it('多行 set-cookie 文本', () => {
    const out = normalizeCookieHeader('a=1; HttpOnly\nb=2; Secure; Max-Age=100')
    expect(out).toBe('a=1; b=2')
  })
  it('空值被过滤', () => {
    expect(normalizeCookieHeader('a=; b=2')).toBe('b=2')
  })
})

describe('parseCookieString / serializeCookieObject', () => {
  it('往返一致', () => {
    const obj = parseCookieString('uin=o0123; login_type=2; wxuin=999')
    expect(obj).toEqual({ uin: 'o0123', login_type: '2', wxuin: '999' })
    expect(serializeCookieObject(obj)).toBe('uin=o0123; login_type=2; wxuin=999')
  })
})

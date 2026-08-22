import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class MockBrowserWindow {},
  session: { fromPartition: vi.fn() },
  shell: { openExternal: vi.fn() },
}))

import { loginNavigationPolicyInternals } from '../../src/main/windows/login-windows'

const { isInSiteLoginUrl, isQQCookieDomain, isNeteaseCookieDomain } = loginNavigationPolicyInternals

/**
 * 登录窗口是全项目唯一加载远程第三方页面的地方，且持有 provider 的 cookie partition、
 * 没有地址栏。导航策略是这里的安全边界，与 server-boundary / electron-ipc-security 同族。
 */
describe('login window navigation boundary', () => {
  describe('非 http(s) scheme 一律不得留在窗口内', () => {
    // 这些 scheme 一旦被转交 shell.openExternal，就等于把任意 URI handler 暴露给远程页面。
    const hostileSchemes = [
      'file:///C:/Windows/System32/calc.exe',
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=passwords',
      'smb://attacker.example/share',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vscode://file/etc/passwd',
    ]

    it.each(hostileSchemes)('拒绝 %s（QQ）', (url) => {
      expect(isInSiteLoginUrl(url, isQQCookieDomain)).toBe(false)
    })

    it.each(hostileSchemes)('拒绝 %s（网易云）', (url) => {
      expect(isInSiteLoginUrl(url, isNeteaseCookieDomain)).toBe(false)
    })
  })

  describe('后缀混淆域名不得进入持有凭据的窗口', () => {
    // 旧实现用的是 /^https?:\/\/([^/]+\.)?(163|music\.163|netease)\.com/i —— 末尾无锚定，
    // 下面前三个都会被它误判为站内。
    const neteaseLookalikes = [
      'https://163.com.attacker.example/login',
      'https://music.163.com.attacker.example/login',
      'https://x.163.com.attacker.example/',
      'https://not163.com/',
      'https://netease.com.evil.tld/',
      'https://163.com@attacker.example/',
    ]

    it.each(neteaseLookalikes)('拒绝 %s', (url) => {
      expect(isInSiteLoginUrl(url, isNeteaseCookieDomain)).toBe(false)
    })

    const qqLookalikes = [
      'https://qq.com.attacker.example/',
      'https://y.qq.com.attacker.example/',
      'https://notqq.com/',
      'https://qqmusic.qq.com.evil.tld/',
    ]

    it.each(qqLookalikes)('拒绝 %s', (url) => {
      expect(isInSiteLoginUrl(url, isQQCookieDomain)).toBe(false)
    })
  })

  describe('provider 自有域仍然放行，登录流程要在窗口内走完', () => {
    it.each([
      'https://music.163.com/#/login',
      'https://music.163.com/login',
      'https://163.com/',
      'https://dun.163.com/captcha',
      'https://netease.com/',
      'https://www.netease.com/path?query=1',
    ])('允许 %s（网易云）', (url) => {
      expect(isInSiteLoginUrl(url, isNeteaseCookieDomain)).toBe(true)
    })

    it.each([
      'https://y.qq.com/n/ryqq/profile',
      'https://y.qq.com/n/ryqq/player',
      'https://qq.com/',
      'https://ssl.ptlogin2.qq.com/js/ptlogin2.js',
      'https://xui.ptlogin2.qq.com/cgi-bin/xlogin',
      'https://graph.qq.com/oauth2.0/authorize',
      'https://open.weixin.qq.com/connect/qrconnect',
    ])('允许 %s（QQ）', (url) => {
      expect(isInSiteLoginUrl(url, isQQCookieDomain)).toBe(true)
    })
  })

  describe('跨 provider 与畸形输入', () => {
    it('网易域名不得进入 QQ 登录窗口', () => {
      expect(isInSiteLoginUrl('https://music.163.com/', isQQCookieDomain)).toBe(false)
    })

    it('QQ 域名不得进入网易登录窗口', () => {
      expect(isInSiteLoginUrl('https://y.qq.com/', isNeteaseCookieDomain)).toBe(false)
    })

    it.each(['', 'not a url', '//music.163.com/', 'https://'])('拒绝畸形输入 %j', (url) => {
      expect(isInSiteLoginUrl(url, isNeteaseCookieDomain)).toBe(false)
      expect(isInSiteLoginUrl(url, isQQCookieDomain)).toBe(false)
    })
  })
})

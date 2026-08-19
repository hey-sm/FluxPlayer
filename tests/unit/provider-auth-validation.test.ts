import { afterEach, describe, expect, it, vi } from 'vitest'
import { NeteaseProvider } from '@server/providers/netease'
import { ncm } from '@server/providers/netease/sdk'
import { QQProvider } from '@server/providers/qq'
import { QQClient } from '@server/providers/qq/client'
import type { CredentialKey, CredentialStore } from '@server/types'

function credentialStore(initial: Partial<Record<CredentialKey, string>>): {
  store: CredentialStore
  read(key: CredentialKey): string
} {
  const values = new Map<CredentialKey, string>([
    ['netease', initial.netease ?? ''],
    ['qq', initial.qq ?? ''],
  ])
  return {
    store: {
      get: (key) => values.get(key) ?? '',
      set: (key, value) => values.set(key, value),
    },
    read: (key) => values.get(key) ?? '',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('provider account validation', () => {
  it('clears a NetEase credential only after an explicit upstream auth rejection', async () => {
    const credentials = credentialStore({ netease: 'MUSIC_U=expired' })
    vi.spyOn(ncm, 'login_status').mockResolvedValue({ body: { data: {} } })
    vi.spyOn(ncm, 'user_account').mockResolvedValue({ body: { code: 301, message: '需要登录' } })

    const result = await new NeteaseProvider(credentials.store).authStatus()

    expect(result).toMatchObject({
      provider: 'netease',
      loggedIn: false,
      hasCookie: false,
      credentialInvalidated: true,
    })
    expect(credentials.read('netease')).toBe('')
  })

  it('accepts an explicit rejection from NetEase login_status as invalidation proof', async () => {
    const credentials = credentialStore({ netease: 'MUSIC_U=expired' })
    vi.spyOn(ncm, 'login_status').mockResolvedValue({ body: { code: 301, message: '需要登录' } })
    const userAccount = vi.spyOn(ncm, 'user_account')

    const result = await new NeteaseProvider(credentials.store).authStatus()

    expect(result).toMatchObject({ credentialInvalidated: true, hasCookie: false, loggedIn: false })
    expect(userAccount).not.toHaveBeenCalled()
    expect(credentials.read('netease')).toBe('')
  })

  it('preserves a NetEase credential when validation is unavailable', async () => {
    const credentials = credentialStore({ netease: 'MUSIC_U=still-present' })
    vi.spyOn(ncm, 'login_status').mockRejectedValue(new Error('network down'))
    vi.spyOn(ncm, 'user_account').mockRejectedValue(new Error('network down'))

    const result = await new NeteaseProvider(credentials.store).authStatus()

    expect(result).toMatchObject({ provider: 'netease', loggedIn: false, hasCookie: true })
    expect(result.credentialInvalidated).not.toBe(true)
    expect(credentials.read('netease')).toBe('MUSIC_U=still-present')
  })

  it('clears a structurally invalid QQ credential before making a profile request', async () => {
    const credentials = credentialStore({ qq: 'foo=bar' })
    const profile = vi.spyOn(QQClient.prototype, 'getJSON')

    const result = await new QQProvider(credentials.store).authStatus()

    expect(result).toMatchObject({
      provider: 'qq',
      loggedIn: false,
      hasCookie: false,
      credentialInvalidated: true,
    })
    expect(profile).not.toHaveBeenCalled()
    expect(credentials.read('qq')).toBe('')
  })

  it('does not treat QQ profile-unavailable codes as proof that a valid session key expired', async () => {
    const cookie = 'uin=123; qm_keyst=KEY'
    const credentials = credentialStore({ qq: cookie })
    vi.spyOn(QQClient.prototype, 'getJSON').mockResolvedValue({ code: 1000 })

    const result = await new QQProvider(credentials.store).authStatus()

    expect(result).toMatchObject({
      provider: 'qq',
      loggedIn: true,
      hasCookie: true,
      profileUnavailable: true,
    })
    expect(result.credentialInvalidated).not.toBe(true)
    expect(credentials.read('qq')).toBe(cookie)
  })

  it('preserves a structurally valid QQ credential when the profile request fails', async () => {
    const cookie = 'uin=123; qm_keyst=KEY'
    const credentials = credentialStore({ qq: cookie })
    vi.spyOn(QQClient.prototype, 'getJSON').mockRejectedValue(new Error('network down'))

    const result = await new QQProvider(credentials.store).authStatus()

    expect(result).toMatchObject({
      provider: 'qq',
      loggedIn: true,
      hasCookie: true,
      profileUnavailable: true,
    })
    expect(result.credentialInvalidated).not.toBe(true)
    expect(credentials.read('qq')).toBe(cookie)
  })
})

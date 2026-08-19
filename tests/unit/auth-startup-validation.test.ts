import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MusicAuthResult } from '@shared/music-contract'
import type { ProviderId } from '@shared/models'

const mocks = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  logout: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@renderer/api', () => ({
  musicClient: {
    getAuthStatus: mocks.getAuthStatus,
    login: vi.fn(),
    logout: mocks.logout,
  },
  musicErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
}))

vi.mock('@renderer/stores/toast', () => ({
  showToast: mocks.showToast,
}))

async function freshAuthStore(): Promise<(typeof import('@renderer/stores/auth'))['useAuth']> {
  vi.resetModules()
  return (await import('@renderer/stores/auth')).useAuth
}

function status(provider: ProviderId, overrides: Partial<MusicAuthResult> = {}): MusicAuthResult {
  return { provider, loggedIn: false, ...overrides }
}

beforeEach(() => {
  mocks.getAuthStatus.mockReset()
  mocks.logout.mockReset().mockResolvedValue(undefined)
  mocks.showToast.mockReset()
})

describe('startup account validation', () => {
  it('starts both provider checks concurrently and deduplicates StrictMode calls', async () => {
    const resolvers = new Map<ProviderId, (value: MusicAuthResult) => void>()
    mocks.getAuthStatus.mockImplementation(
      (provider: ProviderId) =>
        new Promise<MusicAuthResult>((resolve) => {
          resolvers.set(provider, resolve)
        }),
    )
    const useAuth = await freshAuthStore()

    const first = useAuth.getState().validateOnStartup()
    const duplicate = useAuth.getState().validateOnStartup()

    expect(duplicate).toBe(first)
    expect(mocks.getAuthStatus).toHaveBeenCalledTimes(2)
    expect(mocks.getAuthStatus).toHaveBeenCalledWith('netease')
    expect(mocks.getAuthStatus).toHaveBeenCalledWith('qq')

    resolvers.get('netease')?.(status('netease', { loggedIn: true, userId: 1 }))
    resolvers.get('qq')?.(status('qq'))
    await first

    expect(useAuth.getState().netease?.loggedIn).toBe(true)
    expect(useAuth.getState().qq?.loggedIn).toBe(false)
  })

  it('logs out and warns only providers with confirmed invalid credentials', async () => {
    mocks.getAuthStatus.mockImplementation(async (provider: ProviderId) =>
      provider === 'netease'
        ? status('netease', { credentialInvalidated: true })
        : status('qq', { loggedIn: true, userId: '42' }),
    )
    const useAuth = await freshAuthStore()

    await useAuth.getState().validateOnStartup()

    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(mocks.logout).toHaveBeenCalledWith('netease')
    expect(mocks.showToast).toHaveBeenCalledOnce()
    expect(mocks.showToast).toHaveBeenCalledWith('网易云音乐登录已失效，请重新登录', {
      title: '账号登录失效',
      tone: 'warning',
      duration: 8000,
    })
    useAuth.getState().stopQQPolling()
  })

  it('does not warn when neither provider has saved credentials', async () => {
    mocks.getAuthStatus.mockImplementation(async (provider: ProviderId) => status(provider))
    const useAuth = await freshAuthStore()

    await useAuth.getState().validateOnStartup()

    expect(mocks.logout).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('does not erase credentials or warn on a provider/network failure', async () => {
    mocks.getAuthStatus.mockImplementation(async (provider: ProviderId) => {
      if (provider === 'netease') throw new Error('network unavailable')
      return status('qq', { hasCookie: true, profileUnavailable: true })
    })
    const useAuth = await freshAuthStore()

    await useAuth.getState().validateOnStartup()

    expect(useAuth.getState().netease).toBeNull()
    expect(useAuth.getState().qq).toMatchObject({ hasCookie: true, profileUnavailable: true })
    expect(mocks.logout).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalled()
  })
})

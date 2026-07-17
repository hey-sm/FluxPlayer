import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MusicAuthResult } from '@shared/music-contract'
import { musicClient } from '@renderer/api'
import { createQQPollingController, QQ_AUTH_POLL_INTERVAL_MS } from '@renderer/auth/qq-polling'
import { useAuth } from '@renderer/stores/auth'

const musicClientMock = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('@renderer/api', () => ({
  musicClient: musicClientMock,
}))

function qqStatus(loggedIn: boolean): MusicAuthResult {
  return {
    provider: 'qq',
    loggedIn,
    nickname: loggedIn ? 'QQ user' : undefined,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  musicClientMock.getAuthStatus.mockReset()
  musicClientMock.login.mockReset()
  musicClientMock.logout.mockReset().mockResolvedValue(undefined)
  useAuth.getState().stopQQPolling()
  useAuth.setState({
    qq: null,
    qqBusy: false,
    message: '',
  })
})

afterEach(() => {
  useAuth.getState().stopQQPolling()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('QQ auth polling through the typed music client', () => {
  it('refreshes every 45 seconds after a logged-in typed status', async () => {
    musicClientMock.getAuthStatus.mockResolvedValue(qqStatus(true))

    await useAuth.getState().refreshQQ()
    expect(musicClient.getAuthStatus).toHaveBeenCalledTimes(1)
    expect(musicClient.getAuthStatus).toHaveBeenLastCalledWith('qq')

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS - 1)
    expect(musicClient.getAuthStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(musicClient.getAuthStatus).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS)
    expect(musicClient.getAuthStatus).toHaveBeenCalledTimes(3)
  })

  it('starts polling after typed QQ login succeeds', async () => {
    musicClientMock.login.mockResolvedValue(qqStatus(true))
    musicClientMock.getAuthStatus.mockResolvedValue(qqStatus(true))

    await useAuth.getState().loginQQ()
    expect(musicClient.login).toHaveBeenCalledOnce()
    expect(musicClient.login).toHaveBeenCalledWith('qq')
    expect(useAuth.getState().qq).toEqual(qqStatus(true))

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS)
    expect(musicClient.getAuthStatus).toHaveBeenCalledOnce()
    expect(musicClient.getAuthStatus).toHaveBeenCalledWith('qq')
  })

  it('does not start while QQ is logged out', async () => {
    musicClientMock.getAuthStatus.mockResolvedValue(qqStatus(false))

    await useAuth.getState().refreshQQ()
    expect(useAuth.getState().qq?.loggedIn).toBe(false)

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS * 2)
    expect(musicClient.getAuthStatus).toHaveBeenCalledTimes(1)
  })

  it('rejects an auth response for the wrong provider', async () => {
    musicClientMock.getAuthStatus.mockResolvedValue({ provider: 'netease', loggedIn: true })

    await useAuth.getState().refreshQQ()

    expect(useAuth.getState().qq).toBeNull()
    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS * 2)
    expect(musicClient.getAuthStatus).toHaveBeenCalledTimes(1)
  })

  it('stops when a scheduled refresh reports QQ logged out', async () => {
    musicClientMock.getAuthStatus.mockResolvedValueOnce(qqStatus(true)).mockResolvedValue(qqStatus(false))

    await useAuth.getState().refreshQQ()
    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS)
    expect(musicClient.getAuthStatus).toHaveBeenCalledTimes(2)
    expect(useAuth.getState().qq?.loggedIn).toBe(false)

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS * 2)
    expect(musicClient.getAuthStatus).toHaveBeenCalledTimes(2)
  })

  it('stops immediately and clears state when typed logout starts', async () => {
    musicClientMock.getAuthStatus.mockResolvedValue(qqStatus(true))
    await useAuth.getState().refreshQQ()

    await useAuth.getState().logoutQQ()
    expect(musicClient.logout).toHaveBeenCalledWith('qq')

    const statusCallsAfterLogout = musicClientMock.getAuthStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS * 2)
    expect(musicClient.getAuthStatus).toHaveBeenCalledTimes(statusCallsAfterLogout)
    expect(useAuth.getState().qq).toBeNull()
  })

  it('does not stack intervals when started repeatedly', async () => {
    musicClientMock.getAuthStatus.mockResolvedValue(qqStatus(true))
    useAuth.setState({ qq: qqStatus(true) })

    useAuth.getState().startQQPolling()
    useAuth.getState().startQQPolling()
    useAuth.getState().startQQPolling()

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS)
    expect(musicClient.getAuthStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS)
    expect(musicClient.getAuthStatus).toHaveBeenCalledTimes(2)
  })

  it('returns lifecycle cleanup that stops current and future polling', async () => {
    let resolveStatus!: (status: MusicAuthResult) => void
    musicClientMock.getAuthStatus.mockImplementation(
      () =>
        new Promise<MusicAuthResult>((resolve) => {
          resolveStatus = resolve
        }),
    )
    useAuth.setState({ qq: qqStatus(true) })

    const cleanup = useAuth.getState().startQQPolling()
    vi.advanceTimersByTime(QQ_AUTH_POLL_INTERVAL_MS)
    expect(musicClient.getAuthStatus).toHaveBeenCalledTimes(1)

    cleanup()
    resolveStatus(qqStatus(true))
    await Promise.resolve()
    musicClientMock.getAuthStatus.mockResolvedValue(qqStatus(true))

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS * 2)
    expect(musicClient.getAuthStatus).toHaveBeenCalledTimes(1)
  })

  it('contains rejected polling work without an unhandled rejection', async () => {
    const poll = vi.fn().mockRejectedValue(new Error('temporary status failure'))
    const controller = createQQPollingController({ poll })
    const cleanup = controller.start()

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS)

    expect(poll).toHaveBeenCalledTimes(1)
    expect(controller.isRunning()).toBe(true)
    cleanup()
  })
})

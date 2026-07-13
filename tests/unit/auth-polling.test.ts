import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QQLoginInfo } from '@shared/models'
import { apiJson } from '@renderer/api'
import { createQQPollingController, QQ_AUTH_POLL_INTERVAL_MS } from '@renderer/auth/qq-polling'
import { useAuth } from '@renderer/stores/auth'

vi.mock('@renderer/api', () => ({
  apiJson: vi.fn(),
}))

const apiJsonMock = vi.mocked(apiJson)

function qqStatus(loggedIn: boolean): QQLoginInfo {
  return {
    provider: 'qq',
    loggedIn,
    nickname: loggedIn ? 'QQ user' : undefined,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  apiJsonMock.mockReset()
  useAuth.getState().stopQQPolling()
  useAuth.setState({
    qq: null,
    qqBusy: false,
    message: '',
  })
  vi.stubGlobal('window', {
    fluxDesktop: {
      clearQQLogin: vi.fn().mockResolvedValue({ ok: true }),
    },
  })
})

afterEach(() => {
  useAuth.getState().stopQQPolling()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('QQ auth polling', () => {
  it('refreshes every 45 seconds after a logged-in status and keeps cache busting', async () => {
    apiJsonMock.mockResolvedValue(qqStatus(true))

    await useAuth.getState().refreshQQ()
    expect(apiJsonMock).toHaveBeenCalledTimes(1)
    expect(apiJsonMock.mock.calls[0]?.[0]).toMatch(/^\/api\/qq\/login\/status\?t=\d+$/)

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS - 1)
    expect(apiJsonMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(apiJsonMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS)
    expect(apiJsonMock).toHaveBeenCalledTimes(3)
  })

  it('starts after a successful QQ login', async () => {
    vi.stubGlobal('window', {
      fluxDesktop: {
        openQQLogin: vi.fn().mockResolvedValue({
          ok: true,
          cancelled: false,
          cookie: 'uin=12345',
        }),
        clearQQLogin: vi.fn().mockResolvedValue({ ok: true }),
      },
    })
    apiJsonMock.mockResolvedValue(qqStatus(true))

    await useAuth.getState().loginQQ()
    expect(apiJsonMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS)
    expect(apiJsonMock).toHaveBeenCalledTimes(3)
  })

  it('does not start while QQ is logged out', async () => {
    apiJsonMock.mockResolvedValue(qqStatus(false))

    await useAuth.getState().refreshQQ()
    expect(useAuth.getState().qq?.loggedIn).toBe(false)

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS * 2)
    expect(apiJsonMock).toHaveBeenCalledTimes(1)
  })

  it('stops when a scheduled refresh reports QQ logged out', async () => {
    apiJsonMock.mockResolvedValueOnce(qqStatus(true)).mockResolvedValue(qqStatus(false))

    await useAuth.getState().refreshQQ()
    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS)
    expect(apiJsonMock).toHaveBeenCalledTimes(2)
    expect(useAuth.getState().qq?.loggedIn).toBe(false)

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS * 2)
    expect(apiJsonMock).toHaveBeenCalledTimes(2)
  })

  it('stops immediately when QQ logout starts', async () => {
    apiJsonMock.mockResolvedValue(qqStatus(true))
    await useAuth.getState().refreshQQ()

    await useAuth.getState().logoutQQ()
    const callsAfterLogout = apiJsonMock.mock.calls.length

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS * 2)
    expect(apiJsonMock).toHaveBeenCalledTimes(callsAfterLogout)
    expect(useAuth.getState().qq).toBeNull()
  })

  it('does not stack intervals when started repeatedly', async () => {
    apiJsonMock.mockResolvedValue(qqStatus(true))
    useAuth.setState({ qq: qqStatus(true) })

    useAuth.getState().startQQPolling()
    useAuth.getState().startQQPolling()
    useAuth.getState().startQQPolling()

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS)
    expect(apiJsonMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS)
    expect(apiJsonMock).toHaveBeenCalledTimes(2)
  })

  it('returns lifecycle cleanup that stops current and future polling', async () => {
    let resolveStatus!: (status: QQLoginInfo) => void
    apiJsonMock.mockImplementation(
      () =>
        new Promise<QQLoginInfo>((resolve) => {
          resolveStatus = resolve
        }),
    )
    useAuth.setState({ qq: qqStatus(true) })

    const cleanup = useAuth.getState().startQQPolling()
    vi.advanceTimersByTime(QQ_AUTH_POLL_INTERVAL_MS)
    expect(apiJsonMock).toHaveBeenCalledTimes(1)

    cleanup()
    resolveStatus(qqStatus(true))
    await Promise.resolve()
    apiJsonMock.mockResolvedValue(qqStatus(true))

    await vi.advanceTimersByTimeAsync(QQ_AUTH_POLL_INTERVAL_MS * 2)
    expect(apiJsonMock).toHaveBeenCalledTimes(1)
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

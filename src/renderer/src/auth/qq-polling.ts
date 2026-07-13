export const QQ_AUTH_POLL_INTERVAL_MS = 45_000

export type QQPollingIntervalHandle = ReturnType<typeof globalThis.setInterval>

export interface QQPollingScheduler {
  setInterval(callback: () => void, delayMs: number): QQPollingIntervalHandle
  clearInterval(handle: QQPollingIntervalHandle): void
}

export interface QQPollingController {
  start(): () => void
  stop(): void
  isRunning(): boolean
}

interface CreateQQPollingControllerOptions {
  poll: () => void | Promise<void>
  intervalMs?: number
  scheduler?: QQPollingScheduler
}

const defaultScheduler: QQPollingScheduler = {
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearInterval: (handle) => globalThis.clearInterval(handle),
}

/**
 * Owns one QQ auth polling interval. The injected scheduler keeps timer behavior
 * deterministic in tests and the in-flight guard prevents overlapping refreshes.
 */
export function createQQPollingController({
  poll,
  intervalMs = QQ_AUTH_POLL_INTERVAL_MS,
  scheduler = defaultScheduler,
}: CreateQQPollingControllerOptions): QQPollingController {
  let intervalHandle: QQPollingIntervalHandle | null = null
  let pollInFlight = false

  const runPoll = (): void => {
    if (pollInFlight) return
    pollInFlight = true

    let result: void | Promise<void>
    try {
      result = poll()
    } catch {
      pollInFlight = false
      return
    }

    void Promise.resolve(result)
      .catch(() => {})
      .finally(() => {
        pollInFlight = false
      })
  }

  const stop = (): void => {
    if (intervalHandle === null) return
    scheduler.clearInterval(intervalHandle)
    intervalHandle = null
  }

  return {
    start() {
      if (intervalHandle === null) {
        intervalHandle = scheduler.setInterval(runPoll, intervalMs)
      }

      const startedHandle = intervalHandle
      return () => {
        // A stale cleanup from an earlier lifecycle must not stop a newer timer.
        if (intervalHandle === startedHandle) stop()
      }
    },

    stop,

    isRunning() {
      return intervalHandle !== null
    },
  }
}

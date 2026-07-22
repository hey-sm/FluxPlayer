export const SEARCH_CLOSE_DELAY_MS = 160

export interface SearchDismissScheduler {
  cancel(): void
  schedule(dismiss: () => void): void
  dispose(): void
}

export function createSearchDismissScheduler(delayMs = SEARCH_CLOSE_DELAY_MS): SearchDismissScheduler {
  let timeout: ReturnType<typeof setTimeout> | undefined

  const cancel = (): void => {
    if (timeout === undefined) return
    clearTimeout(timeout)
    timeout = undefined
  }

  return {
    cancel,
    schedule(dismiss) {
      cancel()
      timeout = setTimeout(() => {
        timeout = undefined
        dismiss()
      }, delayMs)
    },
    dispose: cancel,
  }
}

export function isSearchDismissKey(key: string): boolean {
  return key === 'Escape'
}

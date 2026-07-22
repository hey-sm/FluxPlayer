import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSearchDismissScheduler,
  isSearchDismissKey,
  SEARCH_CLOSE_DELAY_MS,
} from '@renderer/features/search/interaction'

describe('search hover interaction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps search visible while the pointer crosses from the sensor into the search surface', () => {
    const dismiss = vi.fn()
    const scheduler = createSearchDismissScheduler()

    scheduler.schedule(dismiss)
    vi.advanceTimersByTime(SEARCH_CLOSE_DELAY_MS - 1)
    scheduler.cancel()
    vi.advanceTimersByTime(SEARCH_CLOSE_DELAY_MS)

    expect(dismiss).not.toHaveBeenCalled()
  })

  it('dismisses only after the pointer has left the whole interaction region for the delay', () => {
    const dismiss = vi.fn()
    const scheduler = createSearchDismissScheduler()

    scheduler.schedule(dismiss)
    vi.advanceTimersByTime(SEARCH_CLOSE_DELAY_MS - 1)
    expect(dismiss).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('restarts the delay when another leave transition occurs', () => {
    const dismiss = vi.fn()
    const scheduler = createSearchDismissScheduler()

    scheduler.schedule(dismiss)
    vi.advanceTimersByTime(SEARCH_CLOSE_DELAY_MS - 20)
    scheduler.schedule(dismiss)
    vi.advanceTimersByTime(SEARCH_CLOSE_DELAY_MS - 1)
    expect(dismiss).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('disposes a pending close on unmount and recognizes Escape only', () => {
    const dismiss = vi.fn()
    const scheduler = createSearchDismissScheduler()

    scheduler.schedule(dismiss)
    scheduler.dispose()
    vi.runAllTimers()

    expect(dismiss).not.toHaveBeenCalled()
    expect(isSearchDismissKey('Escape')).toBe(true)
    expect(isSearchDismissKey('Enter')).toBe(false)
  })
})

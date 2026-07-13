import { describe, expect, it, vi } from 'vitest'
import { VisualSceneChannel } from '@renderer/visual/scene'

describe('visual scene channel', () => {
  it('publishes low-frequency snapshots and unsubscribes idempotently', () => {
    const channel = new VisualSceneChannel({ value: 1 })
    const listener = vi.fn()
    const unsubscribe = channel.subscribe(listener)

    channel.set({ value: 2 })
    expect(channel.getSnapshot()).toEqual({ value: 2 })
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenLastCalledWith({ value: 2 })

    unsubscribe()
    unsubscribe()
    channel.set({ value: 3 })
    expect(listener).toHaveBeenCalledOnce()
  })
})

import { describe, expect, it } from 'vitest'
import { clampUpdaterProgress } from '@renderer/features/system/progress'

describe('system maintenance progress', () => {
  it('clamps updater percentages to a scale-safe range', () => {
    expect(clampUpdaterProgress(undefined)).toBe(0)
    expect(clampUpdaterProgress(-4)).toBe(0)
    expect(clampUpdaterProgress(42.5)).toBe(42.5)
    expect(clampUpdaterProgress(140)).toBe(100)
  })
})

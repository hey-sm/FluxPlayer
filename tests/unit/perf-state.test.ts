import { describe, expect, it } from 'vitest'
import {
  derivePerfMode,
  shouldEnableBackgroundThrottling,
  type PerfMode,
  type PerfWindowSignals,
} from '@shared/perf-state'

const modeCases: Array<[PerfWindowSignals, PerfMode]> = [
  [{ isMinimized: false, isVisible: true, isFocused: true }, 'active'],
  [{ isMinimized: false, isVisible: true, isFocused: false }, 'passive'],
  [{ isMinimized: false, isVisible: false, isFocused: true }, 'background'],
  [{ isMinimized: false, isVisible: false, isFocused: false }, 'background'],
  [{ isMinimized: true, isVisible: true, isFocused: true }, 'suspended'],
  [{ isMinimized: true, isVisible: true, isFocused: false }, 'suspended'],
  [{ isMinimized: true, isVisible: false, isFocused: true }, 'suspended'],
  [{ isMinimized: true, isVisible: false, isFocused: false }, 'suspended'],
]

describe('derivePerfMode', () => {
  it.each(modeCases)('derives %j as %s', (signals, expected) => {
    expect(derivePerfMode(signals)).toBe(expected)
  })

  it('keeps priority boundaries minimized > invisible > visible focus', () => {
    expect(derivePerfMode({ isMinimized: true, isVisible: false, isFocused: false })).toBe('suspended')
    expect(derivePerfMode({ isMinimized: false, isVisible: false, isFocused: false })).toBe('background')
    expect(derivePerfMode({ isMinimized: false, isVisible: true, isFocused: false })).toBe('passive')
    expect(derivePerfMode({ isMinimized: false, isVisible: true, isFocused: true })).toBe('active')
  })
})

describe('shouldEnableBackgroundThrottling', () => {
  it.each<[PerfMode, boolean]>([
    ['active', false],
    ['passive', false],
    ['background', true],
    ['suspended', true],
  ])('maps %s to %s', (mode, expected) => {
    expect(shouldEnableBackgroundThrottling(mode)).toBe(expected)
  })
})

import { describe, expect, it } from 'vitest'
import { calculateAnimatedListWindow } from '@renderer/components/react-bits/AnimatedList'

describe('AnimatedList virtualization', () => {
  it('keeps the requested overscan and exact spacer heights', () => {
    expect(calculateAnimatedListWindow(500, 58 * 200, 580, 58, 3)).toEqual({
      start: 197,
      end: 213,
      offsetTop: 197 * 58,
      offsetBottom: (500 - 213) * 58,
    })
  })

  it('clamps empty and out-of-range viewports', () => {
    expect(calculateAnimatedListWindow(0, 0, 500, 58, 3)).toEqual({
      start: 0,
      end: 0,
      offsetTop: 0,
      offsetBottom: 0,
    })
    expect(calculateAnimatedListWindow(10, 99999, 116, 58, 2)).toEqual({
      start: 10,
      end: 10,
      offsetTop: 580,
      offsetBottom: 0,
    })
  })
})

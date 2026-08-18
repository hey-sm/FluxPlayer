import { describe, expect, it } from 'vitest'
import {
  durationForPreference,
  motionDurations,
  parseCssDuration,
  REDUCED_MOTION_QUERY,
} from '@renderer/motion/preferences'
import { resolveAnimatedContentMotionState } from '@renderer/components/react-bits/AnimatedContent'
import { resolveSnapshotTranslate } from '@renderer/components/react-bits/SnapshotAnimatedContent'

describe('renderer motion preferences', () => {
  it('uses one reduced-motion media query and zeroes duration when requested', () => {
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)')
    expect(durationForPreference(motionDurations.base, false)).toBe(0.18)
    expect(durationForPreference(motionDurations.base, true)).toBe(0)
  })

  it('converts CSS duration tokens to the seconds expected by GSAP', () => {
    expect(parseCssDuration('140ms', 1)).toBe(0.14)
    expect(parseCssDuration('0.28s', 1)).toBe(0.28)
    expect(parseCssDuration('invalid', 0.18)).toBe(0.18)
  })

  it('resolves horizontal reverse content motion without mixing axes', () => {
    const state = resolveAnimatedContentMotionState('horizontal', true, 44, true)
    expect(state.axis).toBe('x')
    expect(state.hidden).toMatchObject({
      x: -44,
      opacity: 0,
      visibility: 'hidden',
      pointerEvents: 'none',
    })
    expect(state.shown).toMatchObject({ x: 0, y: 0, opacity: 1, visibility: 'visible' })
    expect(state.exit).toMatchObject({ x: -44, opacity: 0, pointerEvents: 'none' })
  })

  it('keeps opacity visible when only spatial motion is requested', () => {
    expect(resolveAnimatedContentMotionState('vertical', false, 24, false).hidden).toMatchObject({
      y: 24,
      opacity: 1,
    })
  })

  it('resolves the backdrop-safe snapshot offset without moving live glass', () => {
    expect(resolveSnapshotTranslate('horizontal', true, 56)).toBe('-56px 0px')
    expect(resolveSnapshotTranslate('vertical', false, 24)).toBe('0px 24px')
  })
})

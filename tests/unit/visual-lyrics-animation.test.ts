import { describe, expect, it } from 'vitest'
import { parseBackgroundMode } from '@renderer/visual/background-mode'
import {
  isLyricsAnimationMode,
  lyricsAnimationProfile,
  LYRICS_ANIMATION_OPTIONS,
} from '@renderer/visual/lyrics3d-mesh/animation'

describe('lyrics animation preferences', () => {
  it('exposes four independent, persistable animation modes', () => {
    expect(LYRICS_ANIMATION_OPTIONS.map((option) => option.value)).toEqual([
      'compact',
      'fade',
      'lift',
      'focus',
    ])
    expect(isLyricsAnimationMode('focus')).toBe(true)
    expect(isLyricsAnimationMode('unknown')).toBe(false)
  })

  it('uses tighter context spacing and a context-free focus mode', () => {
    expect(lyricsAnimationProfile('compact').lineGap).toBeLessThan(0.5)
    expect(lyricsAnimationProfile('fade').lineGap).toBeLessThan(0.5)
    expect(lyricsAnimationProfile('focus').radius).toBe(0)
    expect(lyricsAnimationProfile('focus').contextOpacity).toBe(0)
    expect(lyricsAnimationProfile('focus').enterScale).toBeLessThan(1)
    expect(lyricsAnimationProfile('focus').exitScale).toBeGreaterThan(1)
  })
})

describe('background replacement preference', () => {
  it('only accepts the two mutually exclusive background modes', () => {
    expect(parseBackgroundMode('dynamic')).toBe('dynamic')
    expect(parseBackgroundMode('wallpaper')).toBe('wallpaper')
    expect(parseBackgroundMode('both')).toBeNull()
    expect(parseBackgroundMode(null)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { parseBackgroundMode } from '@renderer/visual/background-mode'
import { selectLyricWindow } from '@renderer/visual/lyrics3d-mesh/state'
import {
  isLyricsAnimationMode,
  lyricsAnimationProfile,
  LYRICS_ANIMATION_OPTIONS,
  LYRICS_FOCUS_SWITCH,
  type LyricsAnimationMode,
} from '@renderer/visual/lyrics3d-mesh/animation'

describe('lyrics animation preferences', () => {
  it('exposes the compact scroll plus two showcase modes', () => {
    expect(LYRICS_ANIMATION_OPTIONS.map((option) => option.value)).toEqual([
      'compact',
      'cascade',
      'cinematic',
    ])
    expect(isLyricsAnimationMode('cascade')).toBe(true)
    expect(isLyricsAnimationMode('unknown')).toBe(false)
  })

  it('rejects the retired modes so persisted preferences fall back to compact', () => {
    for (const retired of ['fade', 'lift', 'focus']) {
      expect(isLyricsAnimationMode(retired), `${retired} 已下线，必须回落到 compact`).toBe(false)
    }
  })

  it('keeps context spacing tight and scopes the per-glyph cascade to one mode', () => {
    expect(lyricsAnimationProfile('compact').lineGap).toBeLessThan(0.7)
    // 逐字浮现只属于 cascade：其余模式必须是 0，否则着色器会白算一遍位移
    expect(lyricsAnimationProfile('cascade').glyphCascade).toBeGreaterThan(0)
    expect(lyricsAnimationProfile('compact').glyphCascade).toBe(0)
    expect(lyricsAnimationProfile('cinematic').glyphCascade).toBe(0)
    // cascade 的行位移要让位给逐字位移，否则两层运动互相打架
    expect(Math.abs(lyricsAnimationProfile('cascade').enterOffsetY)).toBeLessThan(
      Math.abs(lyricsAnimationProfile('compact').enterOffsetY),
    )
    // 景深推进：入场从更远处来，退场朝镜头推并放大
    expect(lyricsAnimationProfile('cinematic').enterOffsetZ).toBeLessThan(-0.5)
    expect(lyricsAnimationProfile('cinematic').exitOffsetZ).toBeGreaterThan(0)
    expect(lyricsAnimationProfile('cinematic').exitScale).toBeGreaterThan(1)
  })
})

describe('lyrics focus-only switch', () => {
  const lines = [0, 1, 2, 3, 4].map((index) => ({ time: index, text: `第 ${index} 句` }))

  it('collapses the window to just the current line at radius 0', () => {
    // 「只显示当前歌词」是把取词半径压到 0，不是一种动画模式 ——
    // 所以它能和任意 animation mode 组合，而不像旧的 focus 模式那样把两件事绑死。
    const focused = selectLyricWindow(lines, 2, 0, 0)
    expect(focused.map((entry) => entry.index)).toEqual([2])
    expect(focused[0].relativeIndex).toBe(0)
  })

  it('keeps the surrounding context at every mode radius when the switch is off', () => {
    for (const option of LYRICS_ANIMATION_OPTIONS) {
      const radius = lyricsAnimationProfile(option.value).radius
      const window = selectLyricWindow(lines, 2, radius, radius)
      expect(window.length, `${option.value} 关闭开关时应保留上下文`).toBeGreaterThan(1)
    }
  })

  it('moves the outgoing line clear of the incoming one', () => {
    for (const option of LYRICS_ANIMATION_OPTIONS) {
      const profile = lyricsAnimationProfile(option.value)
      const focusSpan = profile.lineGap * LYRICS_FOCUS_SWITCH.exitSpan
      // 焦点模式里新旧两句都停在 relativeIndex 0，退出行必须整整让出一个行位。
      // profile.exitOffsetY 是按"窗口最外沿那句近透明的行"调的（约行距的 17%），
      // 直接用在正中那句满不透明的行上等于原地淡出 —— 两句叠在一起就是残影。
      expect(focusSpan, `${option.value} 退出位移没让出一个行位`).toBeGreaterThan(profile.lineGap)
      expect(focusSpan).toBeGreaterThan(profile.exitOffsetY * 4)
    }
  })

  it('never leaves both lines legible on the same frame', () => {
    // 复刻图层里那两条拆开的 alpha 补间（GSAP power2 = 三次方，.out 即 1-(1-p)³），
    // 断言的是调参结果：任何一帧里"较暗那句"都必须暗到读不出来。
    const cubicOut = (progress: number): number => 1 - (1 - Math.min(1, Math.max(0, progress))) ** 3
    const alphasAt = (mode: LyricsAnimationMode, time: number) => {
      const { duration } = lyricsAnimationProfile(mode)
      const { exitDuration, exitFadeRatio, enterFadeDelay } = LYRICS_FOCUS_SWITCH
      const enterDelay = duration * enterFadeDelay
      return {
        exiting: 1 - cubicOut(time / (duration * exitDuration * exitFadeRatio)),
        entering: cubicOut((time - enterDelay) / (duration - enterDelay)),
      }
    }

    for (const option of LYRICS_ANIMATION_OPTIONS) {
      const { duration } = lyricsAnimationProfile(option.value)
      let worstOverlap = 0
      for (let step = 0; step <= 120; step += 1) {
        const { exiting, entering } = alphasAt(option.value, (step / 120) * duration)
        worstOverlap = Math.max(worstOverlap, Math.min(exiting, entering))
      }
      // 未拆分前两条 alpha 同步跑，中段双双停在 ~0.7 —— 两句都清清楚楚
      expect(worstOverlap, `${option.value} 切句中段两句同时可读`).toBeLessThan(0.1)
    }
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

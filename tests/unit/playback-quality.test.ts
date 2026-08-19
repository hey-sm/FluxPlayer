import { describe, expect, it } from 'vitest'
import { DEFAULT_QUALITY, isQualityDowngrade, qualityLabel } from '@renderer/playback/quality'

describe('DEFAULT_QUALITY', () => {
  it('与服务端空值回退一致（hires）', () => {
    expect(DEFAULT_QUALITY).toBe('hires')
  })
})

describe('isQualityDowngrade', () => {
  it('请求高档实际低档 → true', () => {
    expect(isQualityDowngrade('hires', 'exhigh')).toBe(true)
    expect(isQualityDowngrade('hires', 'standard')).toBe(true)
    expect(isQualityDowngrade('lossless', 'standard')).toBe(true)
  })

  it('同档或更高 → false；未知/空档不判降级（不做 normalize 回退）', () => {
    expect(isQualityDowngrade('hires', 'hires')).toBe(false)
    expect(isQualityDowngrade('exhigh', 'lossless')).toBe(false)
    expect(isQualityDowngrade('hires', 'aac')).toBe(false)
    expect(isQualityDowngrade('hires', '')).toBe(false)
  })
})

describe('qualityLabel', () => {
  it('档位名与旧版一致', () => {
    expect(qualityLabel('jymaster')).toBe('超清母带')
    expect(qualityLabel('hires')).toBe('高清臻音')
    expect(qualityLabel('lossless')).toBe('无损')
    expect(qualityLabel('exhigh')).toBe('极高')
    expect(qualityLabel('standard')).toBe('标准')
  })
})

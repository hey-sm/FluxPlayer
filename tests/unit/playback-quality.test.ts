import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUALITY,
  applyQQQualityCeiling,
  isQualityDowngrade,
  nextQQRetryQuality,
  qqCeilingFromResolved,
  qqRetryQualityPool,
  qualityLabel,
} from '@renderer/playback/quality'

describe('DEFAULT_QUALITY', () => {
  it('与服务端空值回退一致（hires）', () => {
    expect(DEFAULT_QUALITY).toBe('hires')
  })
})

describe('qqRetryQualityPool', () => {
  it('高三档请求 → [exhigh, standard]', () => {
    expect(qqRetryQualityPool('jymaster', '')).toEqual(['exhigh', 'standard'])
    expect(qqRetryQualityPool('hires', '')).toEqual(['exhigh', 'standard'])
    expect(qqRetryQualityPool('lossless', '')).toEqual(['exhigh', 'standard'])
  })

  it('exhigh 请求 → [standard]；standard 请求无候选', () => {
    expect(qqRetryQualityPool('exhigh', '')).toEqual(['standard'])
    expect(qqRetryQualityPool('standard', '')).toEqual([])
  })

  it('requested=standard 但 resolved=hires → [exhigh]（旧版行为：resolved 也能撑开池子，且过滤 requested 自身）', () => {
    expect(qqRetryQualityPool('standard', 'hires')).toEqual(['exhigh'])
  })

  it('resolved 用原始串比对：aac 等未知档不撑池', () => {
    expect(qqRetryQualityPool('standard', 'aac')).toEqual([])
  })
})

describe('nextQQRetryQuality', () => {
  it('顺序取第一个未试档', () => {
    expect(nextQQRetryQuality('hires', '', new Set(['hires']))).toBe('exhigh')
    expect(nextQQRetryQuality('hires', '', new Set(['hires', 'exhigh']))).toBe('standard')
  })

  it('全部试过 → null（编排层据此转换源）', () => {
    expect(nextQQRetryQuality('hires', '', new Set(['hires', 'exhigh', 'standard']))).toBeNull()
    expect(nextQQRetryQuality('standard', '', new Set())).toBeNull()
  })
})

describe('qqCeilingFromResolved', () => {
  it('resolved 为 hires/lossless → 记天花板', () => {
    expect(qqCeilingFromResolved('hires', 'exhigh')).toBe('exhigh')
    expect(qqCeilingFromResolved('lossless', 'exhigh')).toBe('exhigh')
  })

  it('resolved 为空/未知时 normalize 回退 hires → 也记天花板（旧版实测行为，防会话内反复撞高音质 403）', () => {
    expect(qqCeilingFromResolved('', 'exhigh')).toBe('exhigh')
    expect(qqCeilingFromResolved(undefined, 'standard')).toBe('standard')
  })

  it('resolved 为 exhigh/standard → 不记', () => {
    expect(qqCeilingFromResolved('exhigh', 'standard')).toBeNull()
    expect(qqCeilingFromResolved('standard', 'standard')).toBeNull()
  })
})

describe('applyQQQualityCeiling', () => {
  it('高三档请求被压到天花板档', () => {
    expect(applyQQQualityCeiling('hires', 'exhigh')).toBe('exhigh')
    expect(applyQQQualityCeiling('jymaster', 'standard')).toBe('standard')
    expect(applyQQQualityCeiling('lossless', 'exhigh')).toBe('exhigh')
  })

  it('exhigh/standard 请求与无天花板时不变', () => {
    expect(applyQQQualityCeiling('exhigh', 'standard')).toBe('exhigh')
    expect(applyQQQualityCeiling('hires', null)).toBe('hires')
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

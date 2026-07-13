import { describe, expect, it } from 'vitest'
import {
  NETEASE_QUALITY_CANDIDATES,
  QQ_QUALITY_CANDIDATE_TEMPLATES,
  normalizeQualityPreference,
  qualityCandidatesFrom,
} from '@shared/models'

describe('normalizeQualityPreference', () => {
  it('识别各别名', () => {
    expect(normalizeQualityPreference('master')).toBe('jymaster')
    expect(normalizeQualityPreference('svip')).toBe('jymaster')
    expect(normalizeQualityPreference('hi-res')).toBe('hires')
    expect(normalizeQualityPreference('flac')).toBe('lossless')
    expect(normalizeQualityPreference('320')).toBe('exhigh')
    expect(normalizeQualityPreference('128k')).toBe('standard')
  })
  it('未知值回退 hires（与旧版一致）', () => {
    expect(normalizeQualityPreference('')).toBe('hires')
    expect(normalizeQualityPreference('whatever')).toBe('hires')
    expect(normalizeQualityPreference(undefined)).toBe('hires')
  })
})

describe('qualityCandidatesFrom', () => {
  it('网易云：从目标档位起构成降级链', () => {
    const chain = qualityCandidatesFrom('lossless', NETEASE_QUALITY_CANDIDATES)
    expect(chain.map((c) => c.level)).toEqual(['lossless', 'exhigh', 'standard'])
  })
  it('QQ：hires 起含全部模板', () => {
    const chain = qualityCandidatesFrom('hires', QQ_QUALITY_CANDIDATE_TEMPLATES)
    expect(chain.map((c: any) => c.prefix)).toEqual(['RS01', 'F000', 'M800', 'M500', 'C400'])
  })
  it('目标不存在时从头开始', () => {
    const chain = qualityCandidatesFrom('nonsense-level', NETEASE_QUALITY_CANDIDATES)
    // nonsense 先被 normalize 成 hires
    expect(chain[0].level).toBe('hires')
  })
})

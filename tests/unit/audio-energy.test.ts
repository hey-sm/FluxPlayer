import { describe, it, expect } from 'vitest'
import { detectOnsets, mapOnsetsToWords, type EnergySample } from '../../src/renderer/src/playback/audio-energy'

function makeSamples(rmsValues: number[], interval = 0.023): EnergySample[] {
  return rmsValues.map((rms, i) => ({ time: i * interval, rms }))
}

describe('detectOnsets', () => {
  it('detects no onsets for silence', () => {
    const samples = makeSamples([0, 0, 0, 0, 0, 0, 0, 0])
    expect(detectOnsets(samples)).toEqual([])
  })

  it('detects a rising edge', () => {
    const samples = makeSamples([0.01, 0.01, 0.01, 0.01, 0.2, 0.25, 0.3, 0.25, 0.2])
    const onsets = detectOnsets(samples)
    expect(onsets.length).toBe(1)
    expect(onsets[0]).toBeCloseTo(0.092, 2)
  })

  it('detects two separate onsets', () => {
    const samples = makeSamples([
      0.01, 0.01, 0.2, 0.25, 0.2, 0.01, 0.01, 0.01, 0.01, 0.3, 0.35, 0.3,
    ])
    const onsets = detectOnsets(samples)
    expect(onsets.length).toBe(2)
  })

  it('merges onsets closer than 80ms', () => {
    const samples = makeSamples([0.01, 0.2, 0.01, 0.2, 0.01, 0.01, 0.01])
    const onsets = detectOnsets(samples)
    expect(onsets.length).toBe(1)
  })
})

describe('mapOnsetsToWords', () => {
  it('falls back to weighted distribution when no onsets', () => {
    const words = mapOnsetsToWords([], 0, 4, '稻香')
    expect(words.length).toBe(2)
    expect(words[0].text).toBe('稻')
    expect(words[1].text).toBe('香')
    expect(words[0].time).toBe(0)
    const lastEnd = words[words.length - 1].time + words[words.length - 1].duration
    expect(lastEnd).toBeCloseTo(4, 1)
    expect(words.every((w) => w.estimated)).toBe(true)
  })

  it('aligns onsets to character starts', () => {
    const words = mapOnsetsToWords([0, 1.5, 3], 0, 4, '稻香周')
    expect(words.length).toBe(3)
    expect(words[0].text).toBe('稻')
    expect(words[0].time).toBe(0)
    expect(words[1].time).toBeCloseTo(1.5, 1)
    expect(words[2].time).toBeCloseTo(3, 1)
  })

  it('gives punctuation minimal duration', () => {
    const words = mapOnsetsToWords([], 0, 4, '稻，香')
    expect(words.length).toBe(3)
    const commaDur = words[1].duration
    const charDur = words[0].duration + words[2].duration
    expect(commaDur).toBeLessThan(charDur * 0.15)
  })

  it('handles fewer onsets than characters by distributing', () => {
    const words = mapOnsetsToWords([0, 2], 0, 4, '稻香周杰伦')
    expect(words.length).toBe(5)
    for (const w of words) {
      expect(w.time).toBeGreaterThanOrEqual(0)
      expect(w.duration).toBeGreaterThan(0)
    }
    for (let i = 1; i < words.length; i++) {
      expect(words[i].time).toBeGreaterThanOrEqual(words[i - 1].time)
    }
  })

  it('handles more onsets than characters by trimming', () => {
    const words = mapOnsetsToWords([0, 0.5, 1, 1.5, 2], 0, 4, '稻香')
    expect(words.length).toBe(2)
    for (const w of words) {
      expect(w.time).toBeGreaterThanOrEqual(0)
      expect(w.duration).toBeGreaterThan(0)
    }
  })

  it('produces words that cover the singing portion', () => {
    const words = mapOnsetsToWords([0.5, 1.5, 2.5], 0, 4, '稻香周')
    expect(words.length).toBe(3)
    for (const w of words) {
      expect(Number.isFinite(w.duration)).toBe(true)
      expect(w.duration).toBeGreaterThan(0)
    }
    for (let i = 1; i < words.length; i++) {
      expect(words[i].time).toBeGreaterThanOrEqual(words[i - 1].time)
    }
    expect(words[0].time).toBeGreaterThanOrEqual(0)
  })
})

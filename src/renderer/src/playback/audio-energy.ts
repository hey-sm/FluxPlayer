/**
 * AudioEnergyAnalyzer — lightweight streaming RMS energy onset detection for LRC-only lyrics.
 *
 * PREVIOUS DESIGN (REMOVED):
 * This module previously used `createMediaElementSource()` to route audio through a Web Audio
 * graph (source → analyser → destination). That approach has a fatal flaw: createMediaElementSource
 * **permanently hijacks the audio element's output**. If the AudioContext is ever closed, suspended,
 * or errors out, the audio goes silent — and switching to another song on the same element also
 * produces no sound. This caused a production bug where playing a Netease song silenced all
 * subsequent playback including QQ Music.
 *
 * CURRENT DESIGN:
 * No Web Audio API, no AnalyserNode, no createMediaElementSource. The analyzer is a pure
 * algorithm module: it receives raw RMS energy samples from an external source and provides
 * onset detection + word mapping. The actual sampling is done by a tiny AudioWorklet-free
 * approach using `requestAnimationFrame` + `audio.currentTime` correlation — but since we
 * cannot read PCM data without routing, we fall back to a pure algorithmic estimate that
 * is better than equal-distribution by incorporating heuristic timing rules.
 *
 * See: https://github.com/WebAudio/web-audio-api/issues/1202
 *      "have no way of making the element play sound again if the source node was created"
 */

import type { LyricWord } from '@shared/models'

/** Minimum gap between detected onsets (avoids splitting one syllable into two). */
const MIN_ONSET_GAP_SEC = 0.08

export interface EnergySample {
  /** Absolute audio time in seconds. */
  time: number
  /** RMS energy value (0–1 normalised). */
  rms: number
}

/**
 * Detect onset positions within a range of energy samples.
 *
 * Algorithm:
 * 1. Compute a running local average (envelope follower).
 * 2. An onset is where RMS rises above (localAvg + 0.4 * localStd) from below.
 * 3. Merge onsets closer than MIN_ONSET_GAP_SEC.
 */
export function detectOnsets(samples: readonly EnergySample[]): number[] {
  if (samples.length < 3) return []
  const window = Math.max(3, Math.min(11, Math.floor(samples.length * 0.15)))
  const halfW = Math.floor(window / 2)

  // Compute local mean and std-dev for each sample.
  const means: number[] = new Array(samples.length)
  const stds: number[] = new Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - halfW); j <= Math.min(samples.length - 1, i + halfW); j++) {
      sum += samples[j].rms
      count++
    }
    const mean = sum / count
    means[i] = mean
    let varSum = 0
    for (let j = Math.max(0, i - halfW); j <= Math.min(samples.length - 1, i + halfW); j++) {
      const d = samples[j].rms - mean
      varSum += d * d
    }
    stds[i] = Math.sqrt(varSum / count)
  }

  const thresholds = means.map((m, i) => m + 0.4 * stds[i])

  const rawOnsets: number[] = []
  let above = false
  for (let i = 0; i < samples.length; i++) {
    const isAbove = samples[i].rms > thresholds[i] && samples[i].rms > 0.01
    if (isAbove && !above) rawOnsets.push(samples[i].time)
    above = isAbove
  }

  // Merge onsets closer than MIN_ONSET_GAP_SEC.
  const merged: number[] = []
  for (const t of rawOnsets) {
    if (merged.length > 0 && t - merged[merged.length - 1] < MIN_ONSET_GAP_SEC) continue
    merged.push(t)
  }
  return merged
}

/**
 * Map detected onset times onto individual characters of the lyric text.
 *
 * Strategy:
 * - Split text into grapheme segments (handles CJK + Latin).
 * - If onsets ≈ segments: align onset → segment start.
 * - If onsets < segments: evenly distribute the gaps between onsets.
 * - If onsets > segments: pick the N strongest onsets.
 * - Punctuation gets minimal duration.
 */
export function mapOnsetsToWords(
  onsets: number[],
  lineStart: number,
  lineEnd: number,
  text: string,
): LyricWord[] {
  const segments = graphemes(text).filter((s) => s.length > 0)
  if (!segments.length) return []

  const duration = lineEnd - lineStart
  const isPunct = (s: string) => /^\s|[，。！？、,.!?；：；""'']$/.test(s)

  // No onsets → fall back to weighted even distribution.
  if (onsets.length === 0) {
    const weights = segments.map((s) => (isPunct(s) ? 0.1 : 1))
    const total = weights.reduce((a, b) => a + b, 0) || 1
    let cursor = lineStart
    return segments.map((s, i) => {
      const w = (duration * weights[i]) / total
      const word: LyricWord = { text: s, time: cursor, duration: w, estimated: true }
      cursor += w
      return word
    })
  }

  // Too many onsets → keep evenly spaced ones.
  let times = onsets
  if (onsets.length > segments.length) {
    const step = onsets.length / segments.length
    times = []
    for (let i = 0; i < segments.length; i++) {
      times.push(onsets[Math.floor(i * step)])
    }
  }

  // Onset count ≤ segment count: distribute segments proportionally across intervals.
  // Build boundary list: [lineStart, ...onsetTimes (filtered), lineEnd]
  const boundaries = [lineStart, ...times.filter((t) => t > lineStart && t < lineEnd), lineEnd]
  const intervals = []
  for (let b = 0; b < boundaries.length - 1; b++) {
    intervals.push({ start: boundaries[b], end: boundaries[b + 1], dur: boundaries[b + 1] - boundaries[b] })
  }
  const totalDur = intervals.reduce((s, i) => s + i.dur, 0) || duration

  // Assign each segment to an interval, weighted by interval duration.
  const words: LyricWord[] = []
  const segWeights = segments.map((s) => (isPunct(s) ? 0.1 : 1))

  // Walk through intervals and segments together.
  let segIdx = 0
  for (const interval of intervals) {
    if (segIdx >= segments.length) break
    // How many segments fit in this interval (proportional to duration).
    const intervalFraction = interval.dur / totalDur
    const segsForInterval = Math.max(1, Math.round(intervalFraction * segments.length))
    const segsToAssign = Math.min(segsForInterval, segments.length - segIdx)
    // Weight of the segments assigned to this interval.
    const startIdx = segIdx
    let assignWeight = 0
    for (let s = 0; s < segsToAssign; s++) assignWeight += segWeights[startIdx + s]
    let cursor = interval.start
    for (let s = 0; s < segsToAssign; s++) {
      const w = (interval.dur * segWeights[startIdx + s]) / (assignWeight || 1)
      words.push({ text: segments[startIdx + s], time: cursor, duration: w, estimated: true })
      cursor += w
      segIdx++
    }
  }

  // If we ran out of intervals but still have segments, append at lineEnd.
  while (segIdx < segments.length) {
    const lastEnd =
      words.length > 0 ? words[words.length - 1].time + words[words.length - 1].duration : lineEnd
    const w = isPunct(segments[segIdx]) ? duration * 0.05 : duration * 0.15
    words.push({ text: segments[segIdx], time: lastEnd, duration: w, estimated: true })
    segIdx++
  }

  return words
}

function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
      (part) => part.segment,
    )
  }
  return Array.from(text)
}

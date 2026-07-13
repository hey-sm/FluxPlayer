import type { BeatMap } from './types'

const MIN_TEMPO = 30
const MAX_TEMPO = 300

export function normalizeBeatMap(tempo: number, beats: readonly number[], duration: number): BeatMap {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const normalizedBeats = [...new Set(beats.filter((beat) => Number.isFinite(beat) && beat >= 0 && beat <= safeDuration))]
    .sort((a, b) => a - b)

  let normalizedTempo = Number.isFinite(tempo) ? tempo : 0
  if (normalizedBeats.length >= 2) {
    const intervals = normalizedBeats.slice(1).map((beat, index) => beat - normalizedBeats[index]).filter((value) => value > 0)
    intervals.sort((a, b) => a - b)
    const median = intervals[Math.floor(intervals.length / 2)]
    if (!normalizedTempo && median) normalizedTempo = 60 / median
  }
  normalizedTempo = normalizedTempo >= MIN_TEMPO && normalizedTempo <= MAX_TEMPO ? normalizedTempo : 0

  return { tempo: normalizedTempo, beats: normalizedBeats, duration: safeDuration }
}

/** A deterministic 0..1 beat envelope suitable for VisualBus.setBeatPulse(). */
export function beatPulseAtTime(map: Pick<BeatMap, 'beats'>, time: number, decaySeconds = 0.18): number {
  if (!Number.isFinite(time) || decaySeconds <= 0 || map.beats.length === 0) return 0
  let low = 0
  let high = map.beats.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (map.beats[mid] <= time) low = mid + 1
    else high = mid
  }
  const previousBeat = map.beats[low - 1]
  if (previousBeat === undefined) return 0
  const elapsed = time - previousBeat
  return elapsed > decaySeconds ? 0 : Math.max(0, 1 - elapsed / decaySeconds)
}

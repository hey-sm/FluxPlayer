/**
 * useEnergySync + useMergedEnergyLines — audio energy analysis infrastructure.
 *
 * The previous version attached an AnalyserNode via createMediaElementSource, which
 * permanently hijacked audio output and caused silent playback. That approach was removed.
 *
 * The pure-function onset detection and word mapping (from audio-energy.ts) remain
 * available for future use with a safe audio capture method (e.g. OfflineAudioContext
 * on a separately-fetched audio buffer, or Web Audio worklet on a cloned stream).
 * For now, estimated words from estimateWordTimings are used as-is, and the cache
 * infrastructure is retained so a future audio source can populate it without UI changes.
 */

import { useEffect, useRef } from 'react'
import type { LyricLine, LyricWord } from '@shared/models'
import { usePlaybackProgress, usePlayer } from '../../stores/player'
import { useEnergyWords } from '../../stores/energy-words'

/**
 * Check whether a lyric line has only estimated word timings (needs energy analysis).
 * If any word has `estimated !== true`, the line already has real word-level data.
 */
function needsAnalysis(line: LyricLine): boolean {
  if (!line.words?.length) return false
  return line.words.every((w) => w.estimated === true)
}

export function useEnergySync(
  trackKey: string | null,
  _lines: readonly LyricLine[],
): void {
  const position = usePlaybackProgress((s) => s.rawPosition)
  const status = usePlayer((s) => s.status)
  const clearTrack = useEnergyWords((s) => s.clearTrack)
  const clearFromTime = useEnergyWords((s) => s.clearFromTime)
  const clearAll = useEnergyWords((s) => s.clearAll)

  const prevPosition = useRef(0)
  const prevTrackKey = useRef<string | null>(null)

  // --- Track change: clear cache ---
  useEffect(() => {
    if (prevTrackKey.current !== null && prevTrackKey.current !== trackKey) {
      clearTrack(prevTrackKey.current)
    }
    prevTrackKey.current = trackKey
  }, [trackKey, clearTrack])

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      clearAll()
    }
  }, [clearAll])

  // --- Seek detection: clear forward cache on large jumps ---
  useEffect(() => {
    if (!trackKey || !_lines.length) return
    const prev = prevPosition.current
    const delta = Math.abs(position - prev)
    if (delta > 2) {
      clearFromTime(trackKey, position, _lines)
    }
    prevPosition.current = position
  }, [position, trackKey, _lines, clearFromTime])

  // status is read to trigger re-evaluation on play/pause transitions
  void status
}

/**
 * Merge energy-analyzed words into the original lines.
 * Lines without cached analysis keep their original words.
 * Currently a pass-through since no audio source feeds the cache, but the
 * infrastructure is in place for future audio analysis integration.
 */
export function useMergedEnergyLines(
  trackKey: string | null,
  lines: readonly LyricLine[],
): LyricLine[] {
  const cache = useEnergyWords((s) => s.cache)
  if (!trackKey) return lines as unknown as LyricLine[]
  let modified = false
  const result = lines.map((line, i) => {
    if (!needsAnalysis(line)) return line
    const cached = cache.get(`${trackKey}:${i}`)
    if (!cached) return line
    modified = true
    return { ...line, words: cached as LyricWord[] }
  })
  return modified ? result : (lines as unknown as LyricLine[])
}

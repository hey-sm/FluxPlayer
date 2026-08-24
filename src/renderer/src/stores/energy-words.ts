/**
 * Cache store for energy-analyzed word timings.
 *
 * Keyed by `${trackKey}:${lineIndex}` so a track switch or line re-analysis
 * is O(1) lookup. The store is intentionally minimal — it only holds the
 * refined words, not the original lines.
 */

import { create } from 'zustand'
import type { LyricWord } from '@shared/models'

interface EnergyWordsState {
  /** key = `${trackKey}:${lineIndex}` */
  cache: Map<string, LyricWord[]>
  setWords: (trackKey: string, lineIndex: number, words: LyricWord[]) => void
  getWords: (trackKey: string, lineIndex: number) => LyricWord[] | undefined
  clearTrack: (trackKey: string) => void
  clearFromTime: (trackKey: string, timeSec: number, lines: readonly { time: number }[]) => void
  clearAll: () => void
}

function makeKey(trackKey: string, lineIndex: number): string {
  return `${trackKey}:${lineIndex}`
}

export const useEnergyWords = create<EnergyWordsState>((set, get) => ({
  cache: new Map(),

  setWords: (trackKey, lineIndex, words) => {
    set((state) => {
      const cache = new Map(state.cache)
      cache.set(makeKey(trackKey, lineIndex), words)
      return { cache }
    })
  },

  getWords: (trackKey, lineIndex) => get().cache.get(makeKey(trackKey, lineIndex)),

  clearTrack: (trackKey) => {
    set((state) => {
      const cache = new Map(state.cache)
      for (const key of cache.keys()) {
        if (key.startsWith(`${trackKey}:`)) cache.delete(key)
      }
      return { cache }
    })
  },

  /** Clear entries whose line.time >= timeSec (used on seek-forward). */
  clearFromTime: (trackKey, timeSec, lines) => {
    set((state) => {
      const cache = new Map(state.cache)
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].time >= timeSec) cache.delete(makeKey(trackKey, i))
      }
      return { cache }
    })
  },

  clearAll: () => set({ cache: new Map() }),
}))

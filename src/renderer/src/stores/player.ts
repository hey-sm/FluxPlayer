import { create } from 'zustand'
import type { QualityLevel, UnifiedSong } from '@shared/models'
import {
  playbackEngine,
  type PlaybackMode,
  type PlaybackProgressState,
  type PlaybackViewState,
  type PlayStatus,
} from '../playback/engine'

export type { PlaybackMode, PlayStatus }

interface PlayerActions {
  play(song: UnifiedSong): Promise<void>
  setQueue(songs: UnifiedSong[], startIndex?: number): Promise<void>
  setMode(mode: PlaybackMode): void
  setQualityPreference(level: QualityLevel): Promise<void>
  retryWithAlternateSource(): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  toggle(): void
  setVolume(value: number): void
  seek(ratio: number): void
  syncProgress(): void
}

export type PlayerState = PlaybackViewState & PlayerActions

/** High-frequency progress has its own subscription boundary. */
export const usePlaybackProgress = create<PlaybackProgressState>(() => ({ position: 0, duration: 0 }))

export const usePlayer = create<PlayerState>((set, get) => {
  playbackEngine.connect({
    get,
    patch: (patch) => set(patch),
    getProgress: usePlaybackProgress.getState,
    patchProgress: (patch) => usePlaybackProgress.setState(patch),
  })

  return {
    audio: playbackEngine.audio,
    queue: [],
    index: -1,
    current: null,
    status: 'idle',
    message: '',
    notice: '',
    duration: 0,
    position: 0,
    volume: playbackEngine.initialVolume,
    mode: 'sequence',
    qualityPreference: playbackEngine.initialQuality,
    resolvedQuality: null,
    play: (song) => playbackEngine.play(song),
    setQueue: (songs, startIndex) => playbackEngine.setQueue(songs, startIndex),
    setMode: (mode) => playbackEngine.setMode(mode),
    setQualityPreference: (level) => playbackEngine.setQualityPreference(level),
    retryWithAlternateSource: () => playbackEngine.retryWithAlternateSource(),
    next: () => playbackEngine.next(),
    prev: () => playbackEngine.prev(),
    toggle: () => playbackEngine.toggle(),
    setVolume: (value) => playbackEngine.setVolume(value),
    seek: (ratio) => playbackEngine.seek(ratio),
    syncProgress: () => playbackEngine.syncProgress(),
  }
})

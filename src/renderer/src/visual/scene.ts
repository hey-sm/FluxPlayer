import type { StageLyricsFrame } from './lyrics3d'
import type { ShelfFrame } from './shelf'

export type VisualSceneListener<T> = (snapshot: Readonly<T>) => void

/** Separate low-frequency scene channel; VisualBus ABI remains playback/audio-only. */
export class VisualSceneChannel<T extends object> {
  private readonly listeners = new Set<VisualSceneListener<T>>()

  constructor(private snapshot: T) {}

  getSnapshot(): Readonly<T> {
    return this.snapshot
  }

  set(snapshot: T): void {
    this.snapshot = snapshot
    this.listeners.forEach((listener) => listener(snapshot))
  }

  subscribe(listener: VisualSceneListener<T>): () => void {
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }
}

export const stageLyricsChannel = new VisualSceneChannel<StageLyricsFrame>({
  trackKey: null,
  lines: [],
  position: 0,
  accentColor: '#7c8cff',
  visible: false,
})

export const shelfChannel = new VisualSceneChannel<ShelfFrame>({
  items: [],
  centerIndex: 0,
  visible: false,
  accentColor: '#7c8cff',
})

export interface DjBeat {
  time: number
  [key: string]: unknown
}

/** Legacy beat-map shape. New fields may be present, but the old arrays stay intact. */
export interface DjBeatMap {
  kicks: number[]
  beats: DjBeat[]
  pulseBeats: DjBeat[]
  cameraBeats: DjBeat[]
  duration: number
  visualBeatCount: number
  tempoSource: string
  analyzedAt: number
  [key: string]: unknown
}

export interface DjAnalyzeOptions {
  durationSec: number
  introSec?: number
  userAgent?: string
}

export interface PodcastDjAnalyzer {
  analyzeStream(audioUrl: string, options: DjAnalyzeOptions): Promise<DjBeatMap>
  analyzeIntro(audioUrl: string, options: DjAnalyzeOptions & { introSec: number }): Promise<DjBeatMap>
}

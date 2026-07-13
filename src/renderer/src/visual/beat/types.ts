export interface BeatMap {
  tempo: number
  beats: number[]
  duration: number
}

export interface BeatAnalysisInput {
  pcm: Float32Array
  sampleRate: number
  duration: number
}

export interface BeatAnalysisResult extends BeatMap {
  token: number
}

export type BeatAnalysisErrorCode = 'cancelled' | 'timeout' | 'worker' | 'invalid-input' | 'disposed'

export class BeatAnalysisError extends Error {
  constructor(
    public readonly code: BeatAnalysisErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BeatAnalysisError'
  }
}

export interface WorkerAnalyzeMessage extends BeatAnalysisInput {
  type: 'analyze'
  token: number
}

export type WorkerResponse =
  | { type: 'result'; token: number; result: BeatMap }
  | { type: 'error'; token: number; message: string }

import MusicTempo from 'music-tempo'
import { normalizeBeatMap } from './core'
import type { BeatMap } from './types'

interface MusicTempoResult { tempo: number; beats: number[] }
type MusicTempoConstructor = new (audioData: Float32Array, params?: Record<string, number>) => MusicTempoResult

export function resampleForMusicTempo(pcm: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === 44_100) return pcm
  const outputLength = Math.max(1, Math.round((pcm.length * 44_100) / sampleRate))
  const output = new Float32Array(outputLength)
  const ratio = sampleRate / 44_100
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio
    const left = Math.min(pcm.length - 1, Math.floor(position))
    const right = Math.min(pcm.length - 1, left + 1)
    const fraction = position - left
    output[index] = pcm[left] * (1 - fraction) + pcm[right] * fraction
  }
  return output
}

export function analyzePcm(pcm: Float32Array, sampleRate: number, duration: number): BeatMap {
  if (!(pcm instanceof Float32Array) || pcm.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new TypeError('PCM and sampleRate must describe non-empty mono audio')
  }
  const audio = resampleForMusicTempo(pcm, sampleRate)
  const analysis = new (MusicTempo as unknown as MusicTempoConstructor)(audio)
  return normalizeBeatMap(Number(analysis.tempo), analysis.beats, duration)
}

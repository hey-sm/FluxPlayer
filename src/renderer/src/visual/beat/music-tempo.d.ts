declare module 'music-tempo' {
  export default class MusicTempo {
    constructor(audioData: Float32Array, params?: Record<string, number>)
    tempo: number
    beats: number[]
  }
}

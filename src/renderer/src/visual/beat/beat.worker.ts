import { analyzePcm } from './analyze'
import type { WorkerAnalyzeMessage, WorkerResponse } from './types'

self.onmessage = (event: MessageEvent<WorkerAnalyzeMessage>): void => {
  const message = event.data
  if (message.type !== 'analyze') return
  let response: WorkerResponse
  try {
    const pcm = new Float32Array(message.pcm.buffer, message.pcm.byteOffset, message.pcm.length)
    response = { type: 'result', token: message.token, result: analyzePcm(pcm, message.sampleRate, message.duration) }
  } catch (error) {
    response = { type: 'error', token: message.token, message: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(response)
}

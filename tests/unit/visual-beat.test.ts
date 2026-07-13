import { describe, expect, it, vi } from 'vitest'
import { BeatAnalysisClient, BeatAnalysisError, analyzePcm, beatPulseAtTime, normalizeBeatMap, type BeatWorkerLike } from '@renderer/visual/beat'
import type { WorkerAnalyzeMessage, WorkerResponse } from '@renderer/visual/beat/types'

class FakeWorker implements BeatWorkerLike {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage = vi.fn<(message: WorkerAnalyzeMessage, transfer: Transferable[]) => void>()
  terminate = vi.fn()
}

describe('offline visual beat analysis', () => {
  it('detects deterministic 120 BPM synthetic pulses through music-tempo', () => {
    const sampleRate = 44_100
    const duration = 16
    const pcm = new Float32Array(sampleRate * duration)
    for (let beat = 0.5; beat < duration; beat += 0.5) {
      const start = Math.round(beat * sampleRate)
      for (let offset = 0; offset < 900; offset += 1) {
        const envelope = Math.exp(-offset / 180)
        pcm[start + offset] += envelope * Math.sin((2 * Math.PI * 1_200 * offset) / sampleRate)
      }
    }

    const result = analyzePcm(pcm, sampleRate, duration)
    expect(result.tempo).toBeCloseTo(120, 0)
    expect(Math.abs(result.tempo - 120)).toBeLessThanOrEqual(2)
    expect(result.beats.length).toBeGreaterThan(20)
  })
  it('normalizes a known 120 BPM beat sequence and creates a bounded pulse', () => {
    const map = normalizeBeatMap(0, [2, 0, 0.5, 1, 1.5, 0.5, -1, 99], 2)
    expect(map.tempo).toBeCloseTo(120, 5)
    expect(map.beats).toEqual([0, 0.5, 1, 1.5, 2])
    expect(beatPulseAtTime(map, 1)).toBe(1)
    expect(beatPulseAtTime(map, 1.09, 0.18)).toBeCloseTo(0.5)
    expect(beatPulseAtTime(map, 1.3)).toBe(0)
  })

  it('transfers PCM, accepts only the current token, and normalizes worker errors', async () => {
    const workers: FakeWorker[] = []
    const client = new BeatAnalysisClient({ workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker } })
    const pcm = new Float32Array(128)
    const result = client.analyze({ pcm, sampleRate: 44_100, duration: 1 })
    const message = workers[0].postMessage.mock.calls[0][0]
    expect(workers[0].postMessage.mock.calls[0][1]).toEqual([pcm.buffer])

    workers[0].onmessage?.({ data: { type: 'result', token: message.token + 1, result: { tempo: 90, beats: [], duration: 1 } } } as MessageEvent<WorkerResponse>)
    workers[0].onmessage?.({ data: { type: 'result', token: message.token, result: { tempo: 120, beats: [0, 0.5], duration: 1 } } } as MessageEvent<WorkerResponse>)
    await expect(result).resolves.toMatchObject({ token: message.token, tempo: 120 })

    const failed = client.analyze({ pcm: new Float32Array(32), sampleRate: 44_100, duration: 1 })
    const failedMessage = workers[0].postMessage.mock.calls[1][0]
    workers[0].onmessage?.({ data: { type: 'error', token: failedMessage.token, message: 'no beats' } } as MessageEvent<WorkerResponse>)
    await expect(failed).rejects.toMatchObject({ name: 'BeatAnalysisError', code: 'worker', message: 'no beats' })
  })

  it('terminates actual work on supersede, cancel, and timeout', async () => {
    vi.useFakeTimers()
    const workers: FakeWorker[] = []
    const client = new BeatAnalysisClient({ timeoutMs: 20, workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker } })
    const first = client.analyze({ pcm: new Float32Array(8), sampleRate: 44_100, duration: 1 })
    const second = client.analyze({ pcm: new Float32Array(8), sampleRate: 44_100, duration: 1 })
    await expect(first).rejects.toMatchObject({ code: 'cancelled' })
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(client.cancel(999)).toBe(false)
    expect(client.cancel()).toBe(true)
    await expect(second).rejects.toBeInstanceOf(BeatAnalysisError)

    const timedOut = client.analyze({ pcm: new Float32Array(8), sampleRate: 44_100, duration: 1 })
    const timeoutExpectation = expect(timedOut).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(21)
    await timeoutExpectation
    vi.useRealTimers()
  })
  it('normalizes synchronous worker startup failures and leaves no timeout behind', async () => {
    vi.useFakeTimers()
    const factoryClient = new BeatAnalysisClient({
      timeoutMs: 20,
      workerFactory: () => { throw new Error('factory exploded') },
    })
    await expect(factoryClient.analyze({ pcm: new Float32Array(8), sampleRate: 44_100, duration: 1 }))
      .rejects.toMatchObject({ name: 'BeatAnalysisError', code: 'worker' })
    expect(vi.getTimerCount()).toBe(0)

    const worker = new FakeWorker()
    worker.postMessage.mockImplementation(() => { throw new Error('clone failed') })
    const postClient = new BeatAnalysisClient({ timeoutMs: 20, workerFactory: () => worker })
    await expect(postClient.analyze({ pcm: new Float32Array(8), sampleRate: 44_100, duration: 1 }))
      .rejects.toMatchObject({ name: 'BeatAnalysisError', code: 'worker' })
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(postClient.cancel()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(21)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})

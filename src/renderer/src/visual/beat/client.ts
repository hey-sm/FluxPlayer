import { BeatAnalysisError, type BeatAnalysisInput, type BeatAnalysisResult, type WorkerAnalyzeMessage, type WorkerResponse } from './types'

export interface BeatWorkerLike {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: WorkerAnalyzeMessage, transfer: Transferable[]): void
  terminate(): void
}

export type BeatWorkerFactory = () => BeatWorkerLike

export interface BeatAnalysisClientOptions {
  timeoutMs?: number
  workerFactory?: BeatWorkerFactory
}

interface PendingAnalysis {
  token: number
  resolve: (result: BeatAnalysisResult) => void
  reject: (error: BeatAnalysisError) => void
  timeout: ReturnType<typeof setTimeout>
}

const defaultWorkerFactory: BeatWorkerFactory = () =>
  new Worker(new URL('./beat.worker.ts', import.meta.url), { type: 'module', name: 'flux-beat-analysis' })

/** Owns one offline worker. Superseding/cancelling terminates CPU work, not merely its Promise. */
export class BeatAnalysisClient {
  private worker: BeatWorkerLike | null = null
  private pending: PendingAnalysis | null = null
  private nextToken = 1
  private disposed = false
  private readonly timeoutMs: number
  private readonly workerFactory: BeatWorkerFactory

  constructor(options: BeatAnalysisClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory
  }

  analyze(input: BeatAnalysisInput): Promise<BeatAnalysisResult> {
    if (this.disposed) return Promise.reject(new BeatAnalysisError('disposed', 'Beat analysis client is disposed'))
    if (!(input.pcm instanceof Float32Array) || input.pcm.length === 0 || !Number.isFinite(input.sampleRate) || input.sampleRate <= 0 || !Number.isFinite(input.duration) || input.duration <= 0) {
      return Promise.reject(new BeatAnalysisError('invalid-input', 'Expected non-empty Float32 PCM, sampleRate, and duration'))
    }

    if (this.pending) this.stopActive(new BeatAnalysisError('cancelled', 'Beat analysis was superseded'))
    const token = this.nextToken++
    const pcm = input.pcm.byteOffset === 0 && input.pcm.byteLength === input.pcm.buffer.byteLength
      ? input.pcm
      : input.pcm.slice()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending?.token !== token) return
        this.stopActive(new BeatAnalysisError('timeout', `Beat analysis timed out after ${this.timeoutMs}ms`))
      }, this.timeoutMs)
      this.pending = { token, resolve, reject, timeout }

      try {
        const worker = this.ensureWorker()
        worker.postMessage({ type: 'analyze', token, pcm, sampleRate: input.sampleRate, duration: input.duration }, [pcm.buffer])
      } catch (error) {
        this.stopActive(new BeatAnalysisError('worker', 'Failed to start beat analysis worker', { cause: error }))
      }
    })
  }

  cancel(token?: number): boolean {
    if (!this.pending || (token !== undefined && token !== this.pending.token)) return false
    this.stopActive(new BeatAnalysisError('cancelled', 'Beat analysis was cancelled'))
    return true
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopActive(new BeatAnalysisError('disposed', 'Beat analysis client was disposed'))
  }

  private ensureWorker(): BeatWorkerLike {
    if (this.worker) return this.worker
    const worker = this.workerFactory()
    worker.onmessage = (event) => this.handleMessage(event.data)
    worker.onerror = (event) => this.stopActive(new BeatAnalysisError('worker', event.message || 'Beat worker failed'))
    this.worker = worker
    return worker
  }

  private handleMessage(message: WorkerResponse): void {
    const pending = this.pending
    if (!pending || message.token !== pending.token) return
    clearTimeout(pending.timeout)
    this.pending = null
    if (message.type === 'error') pending.reject(new BeatAnalysisError('worker', message.message))
    else pending.resolve({ token: message.token, ...message.result })
  }

  private stopActive(error: BeatAnalysisError): void {
    const pending = this.pending
    this.pending = null
    if (pending) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }
}

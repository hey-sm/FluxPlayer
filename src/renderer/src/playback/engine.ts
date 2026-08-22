import type { PlaybackResolveResult } from '@shared/music-contract'
import type { QualityLevel, UnifiedSong } from '@shared/models'
import { normalizeQualityPreference, QUALITY_ORDER } from '@shared/models'
import {
  bindMediaSession,
  updateMediaMetadata,
  updatePlaybackState,
  updatePositionState,
} from '../media/mediasession'
import { musicClient, musicErrorMessage } from '../api'
import { showToast } from '../stores/toast'
import { DEFAULT_QUALITY, isQualityDowngrade, qualityLabel } from './quality'
import { restrictionMessage } from './restriction'

/** renderer 侧 abort 包装：signal abort 时立即 reject，不等待 IPC 返回。
 *  主进程的 resolvePlayback 仍会完成但结果被忽略。 */
function abortableResolve<T>(operation: Promise<T>, signal: AbortSignal | null): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(new DOMException('The operation was aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new DOMException('The operation was aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) reject(new DOMException('The operation was aborted', 'AbortError'))
        else resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export type PlayStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
export type PlaybackMode = 'sequence' | 'repeat-one' | 'shuffle'

export interface PlaybackViewState {
  audio: HTMLAudioElement
  queue: UnifiedSong[]
  index: number
  current: UnifiedSong | null
  status: PlayStatus
  message: string
  duration: number
  position: number
  volume: number
  mode: PlaybackMode
  qualityPreference: QualityLevel
  resolvedQuality: QualityLevel | null
}

export interface PlaybackProgressState {
  position: number
  duration: number
}

interface StatePort {
  get(): PlaybackViewState
  patch(patch: Partial<PlaybackViewState>): void
  getProgress(): PlaybackProgressState
  patchProgress(patch: Partial<PlaybackProgressState>): void
}

interface LoadOptions {
  qualityOverride?: QualityLevel
}

const DEFAULT_VOLUME = 0.8
const VOLUME_STORAGE_KEY = 'fluxplayer-volume-v1'
const QUALITY_STORAGE_KEY = 'fluxplayer-quality-v1'
const TRIAL_LIMIT_SECONDS = 30
const MEDIA_LOAD_TIMEOUT_MS = 20_000

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function storedVolume(): number {
  try {
    const raw = browserStorage()?.getItem(VOLUME_STORAGE_KEY)?.trim()
    if (!raw) return DEFAULT_VOLUME
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

function storedQuality(): QualityLevel {
  try {
    return normalizeQualityPreference(browserStorage()?.getItem(QUALITY_STORAGE_KEY))
  } catch {
    return DEFAULT_QUALITY
  }
}

function persist(key: string, value: string): void {
  try {
    browserStorage()?.setItem(key, value)
  } catch {
    // Storage can be unavailable for denied origins and unit tests.
  }
}

function errorMessage(error: unknown, fallback = '播放失败'): string {
  return musicErrorMessage(error, fallback)
}

function isOpaqueAudioUrl(url: string | null): url is string {
  return typeof url === 'string' && url.startsWith('flux-media://audio/')
}

/**
 * Owns the single HTMLAudio element and every asynchronous playback transition.
 * Zustand is connected only as an observable UI projection and user-action facade.
 */
export class PlaybackEngine {
  readonly audio: HTMLAudioElement
  readonly initialVolume: number
  readonly initialQuality: QualityLevel

  private port: StatePort | null = null
  private loadGeneration = 0
  private lastPositionSecondPushed = -1
  private lastDurationPushed = -1
  private lastUiProgressSecond = -1
  private activeTrialLimitSeconds: number | null = null
  private shuffleOrder: number[] = []
  private shuffleCursor = -1
  private mediaSessionBound = false
  private pendingAudioLoadCancel: (() => void) | null = null
  private resolveAbort: AbortController | null = null

  constructor(audio: HTMLAudioElement = new Audio()) {
    this.audio = audio
    this.initialVolume = storedVolume()
    this.initialQuality = storedQuality()
    this.audio.preload = 'auto'
    this.audio.volume = this.initialVolume
    this.bindAudioEvents()
  }

  connect(port: StatePort): void {
    this.port = port
    if (this.mediaSessionBound) return
    this.mediaSessionBound = true
    bindMediaSession({
      play: () => {
        const status = this.state().status
        if (status === 'paused' || status === 'idle') this.resumePlayback()
      },
      pause: () => {
        if (this.state().status === 'playing') this.audio.pause()
      },
      next: () => void this.next(),
      prev: () => void this.prev(),
      seekTo: (seconds) => this.seekTo(seconds),
    })
  }

  async play(song: UnifiedSong): Promise<void> {
    await this.setQueue([song], 0)
  }

  async setQueue(songs: readonly UnifiedSong[], startIndex = 0): Promise<void> {
    const queue = [...songs]
    if (!queue.length) {
      this.loadGeneration += 1
      this.cancelPendingAudioLoad()
      this.resolveAbort?.abort()
      this.resolveAbort = null
      this.audio.pause()
      this.audio.src = ''
      this.activeTrialLimitSeconds = null
      this.resetShuffle(0, -1)
      this.patch({
        queue: [],
        index: -1,
        current: null,
        status: 'idle',
        message: '',
        duration: 0,
        position: 0,
        resolvedQuality: null,
      })
      this.patchProgress({ position: 0, duration: 0 })
      updateMediaMetadata(null)
      updatePlaybackState('none')
      return
    }

    const requestedIndex = Number.isFinite(startIndex) ? Math.trunc(startIndex) : 0
    const index = Math.max(0, Math.min(requestedIndex, queue.length - 1))
    this.patch({ queue })
    this.resetShuffle(queue.length, index)
    await this.loadIndex(index)
  }

  setMode(mode: PlaybackMode): void {
    if (mode !== 'sequence' && mode !== 'repeat-one' && mode !== 'shuffle') return
    if (this.state().mode === mode) return
    this.patch({ mode })
    if (mode === 'shuffle') this.resetShuffle(this.state().queue.length, this.state().index)
  }

  async setQualityPreference(level: QualityLevel): Promise<void> {
    const qualityPreference = normalizeQualityPreference(level)
    this.patch({ qualityPreference })
    persist(QUALITY_STORAGE_KEY, qualityPreference)
    const state = this.state()
    if (!state.current || state.index < 0) return
    const resumeAt = this.progress().position
    const remainPaused = state.status === 'paused'
    await this.loadIndex(state.index, { qualityOverride: qualityPreference })
    if (this.state().current?.id !== state.current.id || !this.audio.src) return
    if (resumeAt > 0 && Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = Math.min(resumeAt, this.audio.duration)
    }
    if (remainPaused) this.audio.pause()
  }

  async next(): Promise<void> {
    const { index, mode, queue } = this.state()
    if (!queue.length) return
    const currentIndex = index >= 0 && index < queue.length ? index : -1
    const nextIndex = mode === 'shuffle' ? this.nextShuffleIndex() : (currentIndex + 1) % queue.length
    if (nextIndex < 0) return
    await this.loadIndex(nextIndex)
  }

  async prev(): Promise<void> {
    const { index, mode, queue } = this.state()
    if (!queue.length) return
    const currentIndex = index >= 0 && index < queue.length ? index : 0
    const previousIndex =
      mode === 'shuffle' ? this.previousShuffleIndex() : (currentIndex - 1 + queue.length) % queue.length
    if (previousIndex < 0) return
    await this.loadIndex(previousIndex)
  }

  toggle(): void {
    const { status, index } = this.state()
    if (status === 'playing') this.audio.pause()
    else if (status === 'paused') this.resumePlayback()
    else if (status === 'error' && index >= 0) void this.loadIndex(index)
  }

  setVolume(value: number): void {
    const volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_VOLUME
    this.audio.volume = volume
    this.patch({ volume })
    persist(VOLUME_STORAGE_KEY, String(volume))
  }

  seek(ratio: number): void {
    const duration = this.activeTrialLimitSeconds ?? this.audio.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    this.audio.currentTime = Math.max(0, Math.min(1, ratio)) * duration
    this.syncProgress(true)
  }

  syncProgress(forceUi = false): void {
    if (this.state().status === 'loading') return
    const stateDuration = this.progress().duration || this.state().duration
    const mediaDuration = Number.isFinite(this.audio.duration) ? this.audio.duration : stateDuration
    const duration =
      this.activeTrialLimitSeconds === null
        ? mediaDuration
        : Math.min(mediaDuration || this.activeTrialLimitSeconds, this.activeTrialLimitSeconds)
    const rawPosition =
      this.activeTrialLimitSeconds === null
        ? this.audio.currentTime || 0
        : Math.min(this.audio.currentTime || 0, this.activeTrialLimitSeconds)
    const position = Math.round(rawPosition * 10) / 10
    const durationOut = duration || 0
    const previous = this.progress()
    if (previous.position !== position || previous.duration !== durationOut) {
      this.patchProgress({ position, duration: durationOut })
    }

    const second = Math.floor(position)
    if (forceUi || second !== this.lastUiProgressSecond || this.state().duration !== durationOut) {
      this.lastUiProgressSecond = second
      this.patch({ position, duration: durationOut })
    }
    if (second !== this.lastPositionSecondPushed || durationOut !== this.lastDurationPushed) {
      this.lastPositionSecondPushed = second
      this.lastDurationPushed = durationOut
      updatePositionState(position, durationOut)
    }
  }

  private state(): PlaybackViewState {
    if (!this.port) throw new Error('PlaybackEngine is not connected')
    return this.port.get()
  }

  private progress(): PlaybackProgressState {
    if (!this.port) throw new Error('PlaybackEngine is not connected')
    return this.port.getProgress()
  }

  private patch(patch: Partial<PlaybackViewState>): void {
    if (!this.port) throw new Error('PlaybackEngine is not connected')
    this.port.patch(patch)
  }

  private patchProgress(patch: Partial<PlaybackProgressState>): void {
    if (!this.port) throw new Error('PlaybackEngine is not connected')
    this.port.patchProgress(patch)
  }

  private stale(generation: number): boolean {
    return generation !== this.loadGeneration
  }

  private failPlayback(reason: string): void {
    if (this.state().status === 'error') return
    const message = reason.trim() || '播放失败'
    this.audio.pause()
    this.patch({ status: 'error', message })
    updatePlaybackState('none')
    showToast(message, { title: '播放失败', tone: 'error', duration: 8000 })
  }

  private async loadIndex(index: number, options: LoadOptions = {}): Promise<void> {
    const song = this.state().queue[index]
    if (!song) return
    const generation = ++this.loadGeneration
    this.cancelPendingAudioLoad()
    // 取消上一首歌的取链请求（IPC + 探针），避免快速切歌时多个 resolvePlayback 并发竞争网络
    this.resolveAbort?.abort()
    this.resolveAbort = new AbortController()
    this.activeTrialLimitSeconds = null
    const duration = song.duration / 1000 || 0
    this.patch({
      index,
      current: song,
      status: 'loading',
      message: '',
      position: 0,
      duration,
      resolvedQuality: null,
    })
    this.patchProgress({ position: 0, duration })
    this.audio.pause()
    updateMediaMetadata(song)
    updatePlaybackState('paused')

    const requested = normalizeQualityPreference(options.qualityOverride || this.state().qualityPreference)

    try {
      const info: PlaybackResolveResult = await abortableResolve(
        musicClient.resolvePlayback({ song, quality: requested }),
        this.resolveAbort.signal,
      )
      if (this.stale(generation)) return
      if (!isOpaqueAudioUrl(info.url)) {
        this.failPlayback(restrictionMessage(song, info))
        return
      }

      this.activeTrialLimitSeconds = info.trial ? TRIAL_LIMIT_SECONDS : null
      try {
        await this.playAudioSource(info.url)
      } catch (playError) {
        if (this.stale(generation)) return
        throw playError
      }
      if (this.stale(generation)) return
      if (song.provider === 'netease' && info.level && isQualityDowngrade(requested, info.level)) {
        showToast(`网易云音质自动降级：请求${qualityLabel(requested)}，实际播放${qualityLabel(info.level)}`, {
          title: '音质已自动调整',
          tone: 'warning',
        })
      }
      const resolvedLevel = info.level ? normalizeQualityPreference(info.level) : requested
      // resolvePlayback 实际返回的音质可能高于歌单数据中的 supportedQualities
      // （歌单数据未必包含 size_hires，但实际取链成功），合并进去让下拉列表显示完整档位
      const existingQualities = this.state().current?.supportedQualities
      let updatedSong = this.state().current
      if (updatedSong && existingQualities && !existingQualities.includes(resolvedLevel)) {
        const merged = new Set<QualityLevel>(existingQualities)
        merged.add(resolvedLevel)
        const sorted = QUALITY_ORDER.filter((q) => merged.has(q))
        updatedSong = { ...updatedSong, supportedQualities: sorted }
      }
      this.patch({
        ...(updatedSong ? { current: updatedSong } : {}),
        status: 'playing',
        resolvedQuality: resolvedLevel,
        message: info.trial ? '当前为试听片段' : info.quality ? `音质：${info.quality}` : '',
      })
    } catch (error) {
      if (this.stale(generation)) return
      // AbortError: resolvePlayback 被新切歌取消，静默返回，新 loadIndex 已在管理状态
      if (error instanceof Error && error.name === 'AbortError') return
      if (error instanceof Error && error.name === 'NotAllowedError') {
        this.patch({ status: 'paused', message: '歌曲已载入，点击播放按钮继续播放' })
        updatePlaybackState('paused')
        return
      }
      this.failPlayback(errorMessage(error))
    }
  }

  private cancelPendingAudioLoad(): void {
    const cancel = this.pendingAudioLoadCancel
    this.pendingAudioLoadCancel = null
    cancel?.()
  }

  /**
   * HTMLMediaElement.play() may remain pending when a custom-protocol request fails while loading.
   * Race it against the element's error event and a bounded timeout so the UI can retry or leave loading.
   */
  private playAudioSource(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null

      const cleanup = (): void => {
        this.audio.removeEventListener('error', onError)
        if (timer) clearTimeout(timer)
        if (this.pendingAudioLoadCancel === cancel) this.pendingAudioLoadCancel = null
      }
      const succeed = (): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const onError = (): void => {
        const code = this.audio.error?.code
        fail(new Error(code ? `音频地址加载失败（媒体错误 ${code}）` : '音频地址加载失败'))
      }
      const cancel = (): void => {
        const error = new Error('音频加载已被新的播放请求替换')
        error.name = 'AbortError'
        fail(error)
      }

      this.pendingAudioLoadCancel = cancel
      this.audio.addEventListener('error', onError)
      timer = setTimeout(() => fail(new Error('音频地址加载超时')), MEDIA_LOAD_TIMEOUT_MS)
      this.audio.src = url
      try {
        this.audio.play().then(succeed, fail)
      } catch (error) {
        fail(error)
      }
    })
  }

  private resumePlayback(): void {
    if (this.activeTrialLimitSeconds !== null && this.audio.currentTime >= this.activeTrialLimitSeconds) {
      this.audio.currentTime = 0
      this.patch({ position: 0, duration: this.activeTrialLimitSeconds, message: '当前为试听片段' })
      this.patchProgress({ position: 0, duration: this.activeTrialLimitSeconds })
    }
    this.audio.play().catch((error: unknown) => {
      if (this.state().status === 'loading') return
      if (this.state().current) this.failPlayback(errorMessage(error))
    })
  }

  private seekTo(seconds: number): void {
    const duration = this.activeTrialLimitSeconds ?? this.audio.duration
    if (Number.isFinite(duration) && duration > 0) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, duration))
      this.syncProgress(true)
    }
  }

  private bindAudioEvents(): void {
    this.audio.addEventListener('timeupdate', () => {
      const limit = this.activeTrialLimitSeconds
      if (limit === null || this.audio.currentTime < limit) return
      this.audio.currentTime = limit
      this.audio.pause()
      this.patch({
        status: 'paused',
        position: limit,
        duration: limit,
        message: `${TRIAL_LIMIT_SECONDS} 秒试听已结束`,
      })
      this.patchProgress({ position: limit, duration: limit })
      updatePlaybackState('paused')
    })
    this.audio.addEventListener('ended', () => {
      if (this.state().status === 'loading') return
      const { index, mode, queue } = this.state()
      if (mode === 'repeat-one' && index >= 0) void this.loadIndex(index)
      else if (mode === 'shuffle') {
        const nextIndex = this.nextShuffleIndex()
        if (nextIndex >= 0) void this.loadIndex(nextIndex)
      } else if (queue.length) {
        const currentIndex = index >= 0 && index < queue.length ? index : -1
        void this.loadIndex((currentIndex + 1) % queue.length)
      }
    })
    this.audio.addEventListener('playing', () => {
      if (this.state().status === 'loading') return
      this.patch({ status: 'playing' })
      updatePlaybackState('playing')
    })
    this.audio.addEventListener('pause', () => {
      const status = this.state().status
      if (status !== 'error' && status !== 'loading') {
        this.patch({ status: 'paused' })
        updatePlaybackState('paused')
      }
    })
    this.audio.addEventListener('error', () => {
      if (this.state().status === 'loading') return
      if (this.state().current) {
        this.failPlayback('音频加载失败')
      }
    })
  }

  private shuffled(values: number[]): number[] {
    const result = [...values]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
    }
    return result
  }

  private resetShuffle(queueLength: number, startIndex: number): void {
    if (queueLength <= 0) {
      this.shuffleOrder = []
      this.shuffleCursor = -1
      return
    }
    const indices = Array.from({ length: queueLength }, (_, index) => index)
    if (startIndex >= 0 && startIndex < queueLength) {
      this.shuffleOrder = [startIndex, ...this.shuffled(indices.filter((index) => index !== startIndex))]
      this.shuffleCursor = 0
    } else {
      this.shuffleOrder = this.shuffled(indices)
      this.shuffleCursor = -1
    }
  }

  private appendShuffleRound(queueLength: number, currentIndex: number): void {
    const round = this.shuffled(Array.from({ length: queueLength }, (_, index) => index))
    if (round.length > 1 && round[0] === currentIndex) {
      ;[round[0], round[1]] = [round[1], round[0]]
    }
    this.shuffleOrder.push(...round)
  }

  private nextShuffleIndex(): number {
    const { index, queue } = this.state()
    if (!queue.length) return -1
    if (!this.shuffleOrder.length) this.resetShuffle(queue.length, index)
    if (this.shuffleCursor + 1 >= this.shuffleOrder.length) this.appendShuffleRound(queue.length, index)
    this.shuffleCursor += 1
    return this.shuffleOrder[this.shuffleCursor] ?? -1
  }

  private previousShuffleIndex(): number {
    const { index, queue } = this.state()
    if (!queue.length) return -1
    if (!this.shuffleOrder.length) this.resetShuffle(queue.length, index)
    if (this.shuffleCursor <= 0) {
      const round = this.shuffled(Array.from({ length: queue.length }, (_, itemIndex) => itemIndex))
      if (round.length > 1 && round.at(-1) === index) {
        ;[round[round.length - 1], round[round.length - 2]] = [
          round[round.length - 2],
          round[round.length - 1],
        ]
      }
      this.shuffleOrder.unshift(...round)
      this.shuffleCursor += round.length
    }
    this.shuffleCursor -= 1
    return this.shuffleOrder[this.shuffleCursor] ?? -1
  }
}

export const playbackEngine = new PlaybackEngine()

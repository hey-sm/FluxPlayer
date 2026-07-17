import type { PlaybackResolveResult } from '@shared/music-contract'
import type { QualityLevel, UnifiedSong } from '@shared/models'
import { normalizeQualityPreference } from '@shared/models'
import {
  bindMediaSession,
  updateMediaMetadata,
  updatePlaybackState,
  updatePositionState,
} from '../media/mediasession'
import { PLAYBACK_FAIL_BLOCK_MS, markPlaybackFailed, nextPlayableIndex, songFailKey } from './blacklist'
import { alternateProvider, alternateSearchRequest, pickAlternateSong } from './match'
import { musicClient, musicErrorMessage } from '../api'
import {
  DEFAULT_QUALITY,
  applyQQQualityCeiling,
  isQualityDowngrade,
  nextQQRetryQuality,
  qqCeilingFromResolved,
  qualityLabel,
} from './quality'
import { providerLabel, restrictionCategory, restrictionMessage } from './restriction'

export type PlayStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
export type PlaybackMode = 'sequence' | 'repeat-one' | 'shuffle'

export interface PlaybackViewState {
  audio: HTMLAudioElement
  queue: UnifiedSong[]
  index: number
  current: UnifiedSong | null
  status: PlayStatus
  message: string
  notice: string
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
  manual?: boolean
  qualityOverride?: QualityLevel
  qualityTried?: QualityLevel[]
  fallbackDepth?: number
  disableAlternateRetry?: boolean
}

const DEFAULT_VOLUME = 0.8
const VOLUME_STORAGE_KEY = 'fluxplayer-volume-v1'
const QUALITY_STORAGE_KEY = 'fluxplayer-quality-v1'
const TRIAL_LIMIT_SECONDS = 30
const NETEASE_QUALITY_ORDER: readonly QualityLevel[] = ['jymaster', 'hires', 'lossless', 'exhigh', 'standard']

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

function nextNeteaseQuality(
  requested: QualityLevel,
  resolvedLevel: unknown,
  tried: ReadonlySet<QualityLevel>,
): QualityLevel | null {
  const resolved = String(resolvedLevel || '').toLowerCase() as QualityLevel
  const anchor = NETEASE_QUALITY_ORDER.includes(resolved) ? resolved : requested
  const start = Math.max(0, NETEASE_QUALITY_ORDER.indexOf(anchor))
  for (let index = start + 1; index < NETEASE_QUALITY_ORDER.length; index += 1) {
    const candidate = NETEASE_QUALITY_ORDER[index]
    if (!tried.has(candidate)) return candidate
  }
  return null
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
  private qqQualityCeiling: QualityLevel | null = null
  private readonly failBlacklist = new Map<string, number>()
  private noticeTimer: ReturnType<typeof setTimeout> | null = null
  private lastPositionSecondPushed = -1
  private lastDurationPushed = -1
  private lastUiProgressSecond = -1
  private activeTrialLimitSeconds: number | null = null
  private shuffleOrder: number[] = []
  private shuffleCursor = -1
  private mediaSessionBound = false

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
        notice: '',
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
    this.patch({ queue, notice: '' })
    this.resetShuffle(queue.length, index)
    await this.loadIndex(index, { manual: true })
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
    await this.loadIndex(state.index, { manual: true, qualityOverride: qualityPreference })
    if (this.state().current?.id !== state.current.id || !this.audio.src) return
    if (resumeAt > 0 && Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = Math.min(resumeAt, this.audio.duration)
    }
    if (remainPaused) this.audio.pause()
  }

  async retryWithAlternateSource(): Promise<void> {
    const state = this.state()
    const song = state.current
    const index = state.index
    const previousReason = state.message.trim()
    const fail = (reason: string): void => {
      this.patch({ status: 'error', message: previousReason ? `${previousReason}；${reason}` : reason })
      updatePlaybackState('none')
    }
    if (!song || index < 0 || !state.queue[index]) {
      fail('当前没有可重试的歌曲')
      return
    }
    if (song.type === 'local' || song.type === 'podcast') {
      fail('当前歌曲不支持备用音源重试')
      return
    }
    const request = alternateSearchRequest(song)
    if (!request) {
      fail('当前歌曲缺少可用于匹配备用音源的信息')
      return
    }

    const generation = ++this.loadGeneration
    this.audio.pause()
    this.patch({ status: 'loading' })
    const targetLabel = providerLabel(request.provider)
    this.setNotice(`正在查找${targetLabel}的同名同歌手版本…`)
    try {
      const data = await musicClient.search(request)
      if (this.stale(generation)) return
      const alternate = pickAlternateSong(song, data.songs)
      if (!alternate) {
        fail(`未找到同名同歌手的${targetLabel}版本`)
        return
      }
      const queue = [...this.state().queue]
      queue[index] = alternate
      this.patch({ queue })
      this.setNotice(`已切换备用音源：${song.name || '当前歌曲'} → ${targetLabel}`)
      await this.loadIndex(index, { manual: true, fallbackDepth: 1, disableAlternateRetry: true })
    } catch (error) {
      if (!this.stale(generation)) fail(`备用音源搜索失败：${errorMessage(error, '备用音源搜索失败')}`)
    }
  }

  async next(): Promise<void> {
    const { index, mode, queue } = this.state()
    if (!queue.length) return
    const currentIndex = index >= 0 && index < queue.length ? index : -1
    const nextIndex = mode === 'shuffle' ? this.nextShuffleIndex() : (currentIndex + 1) % queue.length
    if (nextIndex < 0) return
    this.patch({ notice: '' })
    await this.loadIndex(nextIndex)
  }

  async prev(): Promise<void> {
    const { index, mode, queue } = this.state()
    if (!queue.length) return
    const currentIndex = index >= 0 && index < queue.length ? index : 0
    const previousIndex =
      mode === 'shuffle' ? this.previousShuffleIndex() : (currentIndex - 1 + queue.length) % queue.length
    if (previousIndex < 0) return
    this.patch({ notice: '' })
    await this.loadIndex(previousIndex)
  }

  toggle(): void {
    const { status, index } = this.state()
    if (status === 'playing') this.audio.pause()
    else if (status === 'paused') this.resumePlayback()
    else if (status === 'error' && index >= 0) void this.loadIndex(index, { manual: true })
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

  private setNotice(text: string): void {
    this.patch({ notice: text })
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null
      this.patch({ notice: '' })
    }, 5000)
  }

  private async tryQualityRetry(
    index: number,
    generation: number,
    options: LoadOptions,
    info: PlaybackResolveResult | null | undefined,
    requested: QualityLevel,
  ): Promise<boolean> {
    const tried = new Set<QualityLevel>(options.qualityTried || [])
    tried.add(normalizeQualityPreference(requested))
    if (info?.level) tried.add(normalizeQualityPreference(info.level))

    const next =
      this.state().queue[index]?.provider === 'qq'
        ? nextQQRetryQuality(requested, String(info?.level || ''), tried)
        : nextNeteaseQuality(requested, info?.level, tried)
    if (!next || this.stale(generation)) return false

    if (this.state().queue[index]?.provider === 'qq') {
      const ceiling = qqCeilingFromResolved(info?.level, next)
      if (ceiling) this.qqQualityCeiling = ceiling
      this.setNotice(`QQ 音质自动兼容：正在切到${qualityLabel(next)}`)
    } else {
      this.setNotice(`网易云音质自动兼容：正在切到${qualityLabel(next)}`)
    }
    await this.loadIndex(index, { ...options, qualityOverride: next, qualityTried: [...tried] })
    return true
  }

  private async tryAlternateSource(
    song: UnifiedSong,
    info: PlaybackResolveResult | null | undefined,
    index: number,
    generation: number,
    options: LoadOptions,
  ): Promise<boolean> {
    if ((options.fallbackDepth || 0) > 0) {
      this.skipFailed(
        index,
        generation,
        '换源后的版本仍不可播，正在播放下一首',
        restrictionMessage(song, info),
      )
      return true
    }
    if (song.type === 'local' || song.type === 'podcast') return false
    const category = restrictionCategory(info)
    const request = alternateSearchRequest(song)
    if (!request) return false
    const targetLabel = providerLabel(alternateProvider(song.provider))
    this.setNotice(`${providerLabel(song.provider)}当前不可播，正在查找${targetLabel}的同名同歌手版本…`)
    try {
      const data = await musicClient.search(request)
      if (this.stale(generation)) return true
      const alternate = pickAlternateSong(song, data.songs)
      if (!alternate) {
        if (category === 'login_required') return false
        this.skipFailed(
          index,
          generation,
          `没有找到同名同歌手的${targetLabel}版本，正在播放下一首`,
          restrictionMessage(song, info),
        )
        return true
      }
      const queue = [...this.state().queue]
      queue[index] = alternate
      this.patch({ queue })
      this.setNotice(`已自动换源：${song.name || '当前歌曲'} 已切到${targetLabel}`)
      await this.loadIndex(index, { fallbackDepth: 1 })
      return true
    } catch {
      if (!this.stale(generation)) {
        this.skipFailed(index, generation, '自动换源搜索失败，正在播放下一首', '备用音源搜索失败')
      }
      return true
    }
  }

  private skipFailed(index: number, generation: number, notice: string, reason = ''): void {
    if (this.stale(generation)) return
    const { queue, mode } = this.state()
    markPlaybackFailed(this.failBlacklist, queue[index])
    if (queue.length <= 1) {
      const suffix = '当前歌曲不可播放，队列里没有其他歌曲'
      this.patch({ status: 'error', message: reason ? `${reason}；${suffix}` : suffix })
      updatePlaybackState('none')
      return
    }
    const nextIndex =
      mode === 'shuffle'
        ? this.nextPlayableShuffleIndex()
        : nextPlayableIndex(this.failBlacklist, queue, index)
    if (nextIndex < 0) {
      const suffix = '已尝试绕开受限歌曲，队列暂时没有可播项'
      this.patch({ status: 'error', message: reason ? `${reason}；${suffix}` : suffix })
      updatePlaybackState('none')
      return
    }
    this.setNotice(notice)
    void this.loadIndex(nextIndex)
  }

  private async loadIndex(index: number, options: LoadOptions = {}): Promise<void> {
    const song = this.state().queue[index]
    if (!song) return
    const generation = ++this.loadGeneration
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

    let requested = normalizeQualityPreference(options.qualityOverride || this.state().qualityPreference)
    if (song.provider === 'qq') requested = applyQQQualityCeiling(requested, this.qqQualityCeiling)

    let info: PlaybackResolveResult | null = null
    try {
      info = await musicClient.resolvePlayback({ song, quality: requested })
      if (this.stale(generation)) return
      if (!isOpaqueAudioUrl(info.url)) {
        const category = restrictionCategory(info)
        if (
          category !== 'login_required' &&
          (await this.tryQualityRetry(index, generation, options, info, requested))
        )
          return
        if (this.stale(generation)) return
        if (
          !options.disableAlternateRetry &&
          (await this.tryAlternateSource(song, info, index, generation, options))
        )
          return
        if (this.stale(generation)) return
        this.patch({ status: 'error', message: restrictionMessage(song, info) })
        updatePlaybackState('none')
        return
      }

      this.activeTrialLimitSeconds = info.trial ? TRIAL_LIMIT_SECONDS : null
      this.audio.src = info.url
      try {
        await this.audio.play()
      } catch (playError) {
        if (this.stale(generation)) return
        if (await this.tryQualityRetry(index, generation, options, info, requested)) return
        throw playError
      }
      if (this.stale(generation)) return
      if (song.provider === 'netease' && info.level && isQualityDowngrade(requested, info.level)) {
        this.setNotice(
          `网易云音质自动降级：请求${qualityLabel(requested)}，实际播放${qualityLabel(info.level)}`,
        )
      }
      this.patch({
        status: 'playing',
        resolvedQuality: info.level ? normalizeQualityPreference(info.level) : requested,
        message: info.trial ? '当前为试听片段' : info.quality ? `音质：${info.quality}` : '',
      })
    } catch (error) {
      if (this.stale(generation)) return
      if (error instanceof Error && error.name === 'NotAllowedError') {
        this.patch({ status: 'paused', message: '歌曲已载入，点击播放按钮继续播放' })
        updatePlaybackState('paused')
        return
      }
      if (!info && (await this.tryQualityRetry(index, generation, options, undefined, requested))) return
      if (this.stale(generation)) return
      if (
        !options.disableAlternateRetry &&
        (await this.tryAlternateSource(song, info, index, generation, options))
      )
        return
      if (this.stale(generation)) return
      if (!options.manual && this.state().queue.length > 1) {
        this.skipFailed(index, generation, '当前歌曲加载失败，正在尝试下一首')
        return
      }
      this.patch({ status: 'error', message: errorMessage(error) })
      updatePlaybackState('none')
    }
  }

  private resumePlayback(): void {
    if (this.activeTrialLimitSeconds !== null && this.audio.currentTime >= this.activeTrialLimitSeconds) {
      this.audio.currentTime = 0
      this.patch({ position: 0, duration: this.activeTrialLimitSeconds, message: '当前为试听片段' })
      this.patchProgress({ position: 0, duration: this.activeTrialLimitSeconds })
    }
    this.audio.play().catch((error: unknown) => {
      if (this.state().status === 'loading') return
      if (this.state().current) this.patch({ status: 'error', message: errorMessage(error) })
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
        this.patch({ status: 'error', message: '音频加载失败' })
        updatePlaybackState('none')
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

  private nextPlayableShuffleIndex(): number {
    const queue = this.state().queue
    for (let checked = 0; checked < queue.length; checked += 1) {
      const index = this.nextShuffleIndex()
      const song = queue[index]
      const failedAt = song ? this.failBlacklist.get(songFailKey(song)) || 0 : Date.now()
      if (song && (!failedAt || Date.now() - failedAt > PLAYBACK_FAIL_BLOCK_MS)) return index
    }
    return -1
  }
}

export const playbackEngine = new PlaybackEngine()

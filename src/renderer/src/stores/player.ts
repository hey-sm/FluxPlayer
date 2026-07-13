import { create } from 'zustand'
import type { QualityLevel, SongUrlResult, UnifiedSong } from '@shared/models'
import { normalizeQualityPreference } from '@shared/models'
import { apiJson, audioProxyUrl } from '../api'
import {
  bindMediaSession,
  updateMediaMetadata,
  updatePlaybackState,
  updatePositionState,
} from '../media/mediasession'
import {
  DEFAULT_QUALITY,
  applyQQQualityCeiling,
  isQualityDowngrade,
  nextQQRetryQuality,
  qqCeilingFromResolved,
  qualityLabel,
} from '../playback/quality'
import { alternateProvider, alternateSearchPath, pickAlternateSong } from '../playback/match'
import {
  PLAYBACK_FAIL_BLOCK_MS,
  markPlaybackFailed,
  nextPlayableIndex,
  songFailKey,
} from '../playback/blacklist'
import { providerLabel, restrictionCategory, restrictionMessage } from '../playback/restriction'

export type PlayStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
export type PlaybackMode = 'sequence' | 'repeat-one' | 'shuffle'

const DEFAULT_VOLUME = 0.8
const VOLUME_STORAGE_KEY = 'fluxplayer-volume-v1'
const LEGACY_VOLUME_STORAGE_KEY = 'apex-player-volume'
const TRIAL_LIMIT_SECONDS = 30
const QUALITY_STORAGE_KEY = 'fluxplayer-quality-v1'

function storedQuality(): QualityLevel {
  try { return normalizeQualityPreference(browserStorage()?.getItem(QUALITY_STORAGE_KEY)) } catch { return DEFAULT_QUALITY }
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function normalizeStoredVolume(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const text = raw.trim()
  if (!text) return null
  const percent = text.endsWith('%')
  const value = Number(percent ? text.slice(0, -1) : text)
  if (!Number.isFinite(value) || value <= 0) return null
  const normalized = percent || value > 1 ? value / 100 : value
  return normalized > 0 && normalized <= 1 ? normalized : null
}

function storedVolume(): number {
  try {
    const storage = browserStorage()
    if (!storage) return DEFAULT_VOLUME
    const currentRaw = storage.getItem(VOLUME_STORAGE_KEY)
    const current = normalizeStoredVolume(currentRaw)
    if (current !== null) return current

    // The legacy player used another key; accepting both 0..1 and 0..100 also
    // repairs early next-build values. Persisted zero is deliberately not
    // restored: there is no visible mute control, so a restart must stay audible.
    const legacy = normalizeStoredVolume(storage.getItem(LEGACY_VOLUME_STORAGE_KEY))
    const restored = legacy ?? DEFAULT_VOLUME
    if (currentRaw !== null || legacy !== null) storage.setItem(VOLUME_STORAGE_KEY, String(restored))
    return restored
  } catch {
    return DEFAULT_VOLUME
  }
}

function persistVolume(value: number): void {
  try {
    browserStorage()?.setItem(VOLUME_STORAGE_KEY, String(value))
  } catch {
    // localStorage can be unavailable (privacy mode, denied origin, node tests).
  }
}
/** loadIndex 的编排选项（移植旧 playQueueAt 的 opts） */
interface LoadOptions {
  /** 用户直接点选=true：取链/启动异常时报错停住而不是跳下一首（兜底管线内部的跳歌不受此门控） */
  manual?: boolean
  /** 降档重试指定的音质档 */
  qualityOverride?: QualityLevel
  /** 本曲已试过的音质档（含首发档），防止重复降档 */
  qqQualityTried?: QualityLevel[]
  /** 0=原始播放；1=已自动换源过，不再二次换源（防死循环） */
  fallbackDepth?: number
  /** 显式备用源重试使用：候选源失败后直接落可读错误，不再递归换源。 */
  disableAlternateRetry?: boolean
}

interface PlayerState {
  audio: HTMLAudioElement
  /** 当前播放队列 */
  queue: UnifiedSong[]
  /** 当前曲目在队列中的下标（-1 表示无） */
  index: number
  current: UnifiedSong | null
  status: PlayStatus
  message: string
  /** 降档/换源/跳歌的进程气泡（5 秒自动消失），对应旧 source-fallback-notice */
  notice: string
  duration: number
  position: number
  volume: number
  mode: PlaybackMode
  qualityPreference: QualityLevel
  resolvedQuality: QualityLevel | null

  /** 单曲播放：等价于以该曲为唯一队列播放 */
  play(song: UnifiedSong): Promise<void>
  /** 官方队列入口：以队列播放，从 startIndex 开始。 */
  setQueue(songs: UnifiedSong[], startIndex?: number): Promise<void>
  /** M6 前兼容旧调用；行为与 setQueue 完全一致。 */
  playList(songs: UnifiedSong[], startIndex?: number): Promise<void>
  setMode(mode: PlaybackMode): void
  setQualityPreference(level: QualityLevel): Promise<void>
  /** 用户显式要求换平台重试；单次尝试，不会在两个平台间循环。 */
  retryWithAlternateSource(): Promise<void>
  /** 下一首（非空队列在首尾循环） */
  next(): Promise<void>
  /** 上一首（非空队列在首尾循环） */
  prev(): Promise<void>
  toggle(): void
  setVolume(value: number): void
  seek(ratio: number): void
  syncProgress(): void
}

function songUrlEndpoint(song: UnifiedSong, quality: QualityLevel): string {
  const qualityParam = `&quality=${encodeURIComponent(quality)}`
  if (song.provider === 'qq') {
    const mid = encodeURIComponent(String(song.mid || song.songmid || song.id || ''))
    const mediaMid = encodeURIComponent(String(song.mediaMid || ''))
    return `/api/qq/song/url?mid=${mid}&mediaMid=${mediaMid}${qualityParam}`
  }
  return `/api/song/url?id=${encodeURIComponent(String(song.id))}${qualityParam}`
}

export const usePlayer = create<PlayerState>((set, get) => {
  const audio = new Audio()
  const initialVolume = storedVolume()
  audio.preload = 'auto'
  audio.volume = initialVolume

  // 单调递增的加载代次：每次切歌/换队列自增一次。异步取链结果只在
  // 代次未变时才生效——用 index 相等判断挡不住"同下标换了新队列"的竞态。
  let loadGeneration = 0
  // 会话级 QQ 音质天花板：高音质拿到 purl 但 CDN 拒流后压档，本会话不再反复撞 403
  let qqQualityCeiling: QualityLevel | null = null
  // 播放失败黑名单（18s 窗口），跳歌时绕开刚失败的曲目
  const failBlacklist = new Map<string, number>()
  let noticeTimer: ReturnType<typeof setTimeout> | null = null
  // MediaSession 位置上报的节流锚点（整秒/时长变化才推，避免每帧跨进程 IPC）
  let lastPositionSecondPushed = -1
  let lastDurationPushed = -1
  // 两个平台的受限歌曲统一只播放前 30 秒，不能因上游偶尔返回 45 秒片段而越界。
  let activeTrialLimitSeconds: number | null = null
  // shuffleOrder 同时是已生成的播放牌组与历史；cursor 后退后，next 会先重走历史。
  // 每轮恰好包含队列所有下标一次，轮末再追加新一轮，避免一轮内重复。
  let shuffleOrder: number[] = []
  let shuffleCursor = -1

  function shuffled(values: number[]): number[] {
    const result = values.slice()
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }

  function resetShuffle(queueLength: number, startIndex: number): void {
    if (queueLength <= 0) {
      shuffleOrder = []
      shuffleCursor = -1
      return
    }
    const indices = Array.from({ length: queueLength }, (_, index) => index)
    if (startIndex >= 0 && startIndex < queueLength) {
      shuffleOrder = [startIndex, ...shuffled(indices.filter((index) => index !== startIndex))]
      shuffleCursor = 0
      return
    }
    shuffleOrder = shuffled(indices)
    shuffleCursor = -1
  }

  function appendShuffleRound(queueLength: number, currentIndex: number): void {
    const round = shuffled(Array.from({ length: queueLength }, (_, index) => index))
    // 多曲队列的轮次边界也不立即重复当前曲；单曲队列只能重复自身。
    if (round.length > 1 && round[0] === currentIndex) {
      ;[round[0], round[1]] = [round[1], round[0]]
    }
    shuffleOrder.push(...round)
  }

  function nextShuffleIndex(): number {
    const { index, queue } = get()
    if (!queue.length) return -1
    if (!shuffleOrder.length) resetShuffle(queue.length, index)
    if (shuffleCursor + 1 >= shuffleOrder.length) appendShuffleRound(queue.length, index)
    shuffleCursor += 1
    return shuffleOrder[shuffleCursor] ?? -1
  }

  function previousShuffleIndex(): number {
    const { index, queue } = get()
    if (!queue.length) return -1
    if (!shuffleOrder.length) resetShuffle(queue.length, index)
    if (shuffleCursor <= 0) {
      const round = shuffled(Array.from({ length: queue.length }, (_, itemIndex) => itemIndex))
      // Prepend an earlier round without discarding generated forward history.
      // Its final item is the direct predecessor, so avoid an immediate repeat.
      if (round.length > 1 && round.at(-1) === index) {
        ;[round[round.length - 1], round[round.length - 2]] = [
          round[round.length - 2],
          round[round.length - 1],
        ]
      }
      shuffleOrder.unshift(...round)
      shuffleCursor += round.length
    }
    shuffleCursor -= 1
    return shuffleOrder[shuffleCursor] ?? -1
  }

  function isRecentlyFailed(index: number): boolean {
    const song = get().queue[index]
    if (!song) return true
    const failedAt = failBlacklist.get(songFailKey(song)) || 0
    return failedAt > 0 && Date.now() - failedAt <= PLAYBACK_FAIL_BLOCK_MS
  }

  function nextPlayableShuffleIndex(): number {
    const queueLength = get().queue.length
    // 最多检查一整轮；全被屏蔽时终止，不能不断追加新牌组。
    for (let checked = 0; checked < queueLength; checked += 1) {
      const index = nextShuffleIndex()
      if (index >= 0 && !isRecentlyFailed(index)) return index
    }
    return -1
  }
  function stale(generation: number): boolean {
    return loadGeneration !== generation
  }

  function setNotice(text: string): void {
    set({ notice: text })
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => {
      noticeTimer = null
      set({ notice: '' })
    }, 5000)
  }

  /**
   * 兜底层 1 —— QQ 降档重取（移植旧 retryQQPlaybackWithCompatibleQuality）。
   * QQ 常对高音质返回 purl 但 CDN 拒流（代理 403 → play() reject "no supported source"），
   * 降到 exhigh/standard 重新取链才有救；也覆盖高档取链整单被拒的少数场景。
   */
  async function tryQQQualityRetry(
    index: number,
    generation: number,
    opts: LoadOptions,
    info: SongUrlResult | null | undefined,
    requested: QualityLevel,
  ): Promise<boolean> {
    const tried = new Set<QualityLevel>(opts.qqQualityTried || [])
    tried.add(normalizeQualityPreference(requested))
    if (info && info.level) tried.add(normalizeQualityPreference(info.level))
    const resolvedLevel = String((info && info.level) || '')
    const next = nextQQRetryQuality(requested, resolvedLevel, tried)
    if (!next || stale(generation)) return false
    const ceiling = qqCeilingFromResolved(info && info.level, next)
    if (ceiling) qqQualityCeiling = ceiling
    setNotice(`QQ 音质自动兼容：正在切到${qualityLabel(next)}`)
    await loadIndex(index, { ...opts, qualityOverride: next, qqQualityTried: [...tried] })
    return true
  }

  /**
   * 兜底层 2 —— 自动换源（移植旧 tryAutoPlaybackFallback）：
   * 搜另一平台同名同歌手版本替换队列项后重播，深度限 1。
   * 受限歌在旧版的"30 秒试听"正是来自这里——换到网易云后由服务端 trialFallback 返回试听地址。
   */
  async function tryAlternateSource(
    song: UnifiedSong,
    info: SongUrlResult | null | undefined,
    index: number,
    generation: number,
    opts: LoadOptions,
  ): Promise<boolean> {
    if ((opts.fallbackDepth || 0) > 0) {
      skipFailed(index, generation, '换源后的版本仍不可播，正在播放下一首', restrictionMessage(song, info))
      return true
    }
    // source 用 String 比较：旧数据源的播客条目 type 形状不一，只有 source 标 'podcast'
    if (song.type === 'local' || song.type === 'podcast' || String(song.source) === 'podcast') return false
    const category = restrictionCategory(info)
    const path = alternateSearchPath(song)
    if (!path) return false
    const targetLabel = providerLabel(alternateProvider(song.provider))
    setNotice(`${providerLabel(song.provider)}当前不可播，正在查找${targetLabel}的同名同歌手版本…`)
    try {
      const data = await apiJson<{ songs?: UnifiedSong[] }>(path)
      if (stale(generation)) return true
      // apiJson 不抛 HTTP 错：无 songs 数组说明搜索本身故障（如 500），别误报"曲库无此歌"
      const songs = data && Array.isArray(data.songs) ? data.songs : null
      if (!songs) {
        skipFailed(index, generation, '自动换源搜索失败，正在播放下一首', '备用音源搜索失败')
        return true
      }
      const alternate = pickAlternateSong(song, songs)
      if (!alternate) {
        // 登录问题换源救不了：落回终态文案引导登录
        if (category === 'login_required') return false
        skipFailed(
          index,
          generation,
          `没有找到同名同歌手的${targetLabel}版本，正在播放下一首`,
          restrictionMessage(song, info),
        )
        return true
      }
      const queue = get().queue.slice()
      queue[index] = alternate
      set({ queue })
      setNotice(`已自动换源：${song.name || '当前歌曲'} 已切到${targetLabel}`)
      // 与旧版一致不透传 manual：换源版本再失败继续走自动跳歌，不硬停
      await loadIndex(index, { fallbackDepth: 1 })
      return true
    } catch {
      if (stale(generation)) return true
      skipFailed(index, generation, '自动换源搜索失败，正在播放下一首', '备用音源搜索失败')
      return true
    }
  }

  /** 兜底层 3 —— 跳过失败曲目（移植旧 skipFailedQueueItem），黑名单防止在坏歌间打转 */
  function skipFailed(index: number, generation: number, noticeText: string, reason = ''): void {
    if (stale(generation)) return
    const { queue } = get()
    markPlaybackFailed(failBlacklist, queue[index])
    if (queue.length <= 1) {
      const suffix = '当前歌曲不可播放，队列里没有其他歌曲'
      set({ status: 'error', message: reason ? `${reason}；${suffix}` : suffix })
      updatePlaybackState('none')
      return
    }
    const nextIdx =
      get().mode === 'shuffle' ? nextPlayableShuffleIndex() : nextPlayableIndex(failBlacklist, queue, index)
    if (nextIdx < 0) {
      const suffix = '已尝试绕开受限歌曲，队列暂时没有可播项'
      set({ status: 'error', message: reason ? `${reason}；${suffix}` : suffix })
      updatePlaybackState('none')
      return
    }
    setNotice(noticeText)
    // 不 await：断开递归调用链（旧版同样扁平化），代次由新 loadIndex 自增接管
    void loadIndex(nextIdx, {})
  }

  // 取链并播放队列中 index 位置的曲目
  async function loadIndex(index: number, opts: LoadOptions = {}): Promise<void> {
    const { queue } = get()
    const song = queue[index]
    if (!song) return
    const generation = ++loadGeneration
    activeTrialLimitSeconds = null
    set({
      index,
      current: song,
      status: 'loading',
      message: '',
      position: 0,
      duration: song.duration / 1000 || 0,
      resolvedQuality: null,
    })
    // 旧版 playQueueAt 第一步：切歌先停旧曲——取链/兜底期间旧曲继续出声会变成
    // 无法停止的"僵尸播放"，其 ended 事件还会按新 index 劫持队列前进
    audio.pause()
    updateMediaMetadata(song)
    updatePlaybackState('paused')
    let requested = normalizeQualityPreference(opts.qualityOverride || get().qualityPreference)
    if (song.provider === 'qq') requested = applyQQQualityCeiling(requested, qqQualityCeiling)
    try {
      const info = await apiJson<SongUrlResult>(songUrlEndpoint(song, requested))
      // 取链是异步的：若期间用户又切了歌/换了队列，丢弃这次结果
      if (stale(generation)) return
      if (!info || !info.url) {
        const category = restrictionCategory(info)
        // login_required 换音质救不了，跳过降档直接换源/终态，避免"音质自动兼容"误导气泡
        if (
          song.provider === 'qq' &&
          category !== 'login_required' &&
          (await tryQQQualityRetry(index, generation, opts, info, requested))
        ) {
          return
        }
        if (stale(generation)) return
        if (!opts.disableAlternateRetry && (await tryAlternateSource(song, info, index, generation, opts)))
          return
        if (stale(generation)) return
        set({ status: 'error', message: restrictionMessage(song, info) })
        updatePlaybackState('none')
        return
      }
      activeTrialLimitSeconds = info.trial ? TRIAL_LIMIT_SECONDS : null
      audio.src = audioProxyUrl(info.url)
      try {
        await audio.play()
      } catch (playErr) {
        if (stale(generation)) return
        if (song.provider === 'qq' && (await tryQQQualityRetry(index, generation, opts, info, requested)))
          return
        throw playErr
      }
      if (stale(generation)) return
      // 网易云降档提示（旧 playbackQualityWasDowngraded）：请求高档实际回落时点破
      if (song.provider !== 'qq' && info.level && isQualityDowngrade(requested, info.level)) {
        setNotice(`网易云音质自动降级：请求${qualityLabel(requested)}，实际播放${qualityLabel(info.level)}`)
      }
      const resolvedQuality = info.level ? normalizeQualityPreference(info.level) : requested
      set({
        status: 'playing',
        resolvedQuality,
        message: info.trial ? '当前为试听片段' : info.quality ? `音质：${info.quality}` : '',
      })
    } catch (e: any) {
      if (stale(generation)) return
      // autoplay 策略/需要用户手势类拒绝：歌已载入，别跳歌拉黑（旧版独立分支）
      if (e && e.name === 'NotAllowedError') {
        set({ status: 'paused', message: '歌曲已载入，点击播放按钮继续播放' })
        updatePlaybackState('paused')
        return
      }
      // 自动播放（切歌/队列前进）失败不卡死：跳到下一首
      if (!opts.manual && get().queue.length > 1) {
        skipFailed(index, generation, '当前歌曲加载失败，正在尝试下一首')
        return
      }
      set({ status: 'error', message: e?.message || '播放失败' })
      updatePlaybackState('none')
    }
  }

  // 恢复播放（暂停/系统控件触发）。audio.play() 可能因浏览器策略或无 src 而 reject，
  // 裸 void 会漏成 unhandled rejection——统一捕获并落到 error 状态。
  function resumePlayback(): void {
    const trialLimit = activeTrialLimitSeconds
    if (trialLimit !== null && audio.currentTime >= trialLimit) {
      audio.currentTime = 0
      set({ position: 0, duration: trialLimit, message: '当前为试听片段' })
    }
    audio.play().catch((e: any) => {
      // 后续 loadIndex 重设 src 会以 AbortError 拒绝挂起的 play()——新加载已接管状态
      if (get().status === 'loading') return
      if (get().current) set({ status: 'error', message: e?.message || '播放失败' })
    })
  }

  audio.addEventListener('timeupdate', () => {
    const limit = activeTrialLimitSeconds
    if (limit === null || audio.currentTime < limit) return
    audio.currentTime = limit
    audio.pause()
    set({
      status: 'paused',
      position: limit,
      duration: limit,
      message: `${TRIAL_LIMIT_SECONDS} 秒试听已结束`,
    })
    updatePlaybackState('paused')
  })

  audio.addEventListener('ended', () => {
    // 取链窗口期的 ended 属于已被切走的旧曲，不得按新 index 前进（守卫见 loadIndex 的 pause）
    if (get().status === 'loading') return
    const { index, mode, queue } = get()
    if (mode === 'repeat-one' && index >= 0) {
      void loadIndex(index, {})
      return
    }
    if (mode === 'shuffle') {
      const nextIndex = nextShuffleIndex()
      if (nextIndex >= 0) void loadIndex(nextIndex, {})
      return
    }
    // sequence is list-repeat; a one-item queue naturally reloads itself.
    if (queue.length > 0) {
      const currentIndex = index >= 0 && index < queue.length ? index : -1
      void loadIndex((currentIndex + 1) % queue.length, {})
    }
  })
  audio.addEventListener('playing', () => {
    // 与 pause/error 对称：loading 期间旧曲缓冲恢复的 playing 不得篡改新歌状态
    if (get().status === 'loading') return
    set({ status: 'playing' })
    updatePlaybackState('playing')
  })
  audio.addEventListener('pause', () => {
    if (get().status !== 'error' && get().status !== 'loading') {
      set({ status: 'paused' })
      updatePlaybackState('paused')
    }
  })
  audio.addEventListener('error', () => {
    // 取链/启动阶段（loading）的失败由 loadIndex 的 play() catch 统一编排：
    // 同一个 403 会同时触发 play() reject 和 error 事件，这里让位避免打断降档重试
    if (get().status === 'loading') return
    if (get().current) {
      set({ status: 'error', message: '音频加载失败' })
      updatePlaybackState('none')
    }
  })

  // 系统媒体控件 → player。绑定一次，全程有效。
  bindMediaSession({
    play: () => {
      const { status } = get()
      if (status === 'paused' || status === 'idle') resumePlayback()
    },
    pause: () => {
      if (get().status === 'playing') audio.pause()
    },
    next: () => void get().next(),
    prev: () => void get().prev(),
    seekTo: (seconds) => {
      const duration = activeTrialLimitSeconds ?? audio.duration
      if (Number.isFinite(duration) && duration > 0) {
        audio.currentTime = Math.max(0, Math.min(seconds, duration))
      }
    },
  })

  return {
    audio,
    queue: [],
    index: -1,
    current: null,
    status: 'idle',
    message: '',
    notice: '',
    duration: 0,
    position: 0,
    volume: initialVolume,
    mode: 'sequence',
    qualityPreference: storedQuality(),
    resolvedQuality: null,

    async play(song) {
      await get().setQueue([song], 0)
    },

    async setQueue(songs, startIndex = 0) {
      const queue = songs.slice()
      if (!queue.length) {
        loadGeneration += 1
        audio.pause()
        audio.src = ''
        activeTrialLimitSeconds = null
        resetShuffle(0, -1)
        set({
          queue: [],
          index: -1,
          current: null,
          status: 'idle',
          message: '',
          notice: '',
          duration: 0,
          position: 0,
        })
        updateMediaMetadata(null)
        updatePlaybackState('none')
        return
      }
      const requestedIndex = Number.isFinite(startIndex) ? Math.trunc(startIndex) : 0
      const index = Math.max(0, Math.min(requestedIndex, queue.length - 1))
      // 用户发起新播放意图：清掉上一轮兜底流程的残留气泡，并重建 shuffle 牌组。
      set({ queue, notice: '' })
      resetShuffle(queue.length, index)
      await loadIndex(index, { manual: true })
    },

    async playList(songs, startIndex = 0) {
      await get().setQueue(songs, startIndex)
    },

    async setQualityPreference(level) {
      const qualityPreference = normalizeQualityPreference(level)
      set({ qualityPreference })
      try { browserStorage()?.setItem(QUALITY_STORAGE_KEY, qualityPreference) } catch { /* session only */ }
      const state = get()
      if (!state.current || state.index < 0) return
      const resumeAt = state.position
      const remainPaused = state.status === 'paused'
      await loadIndex(state.index, { manual: true, qualityOverride: qualityPreference })
      if (get().current?.id !== state.current.id || !audio.src) return
      if (resumeAt > 0 && Number.isFinite(audio.duration)) audio.currentTime = Math.min(resumeAt, audio.duration)
      if (remainPaused) audio.pause()
    },

    setMode(mode) {
      if (mode !== 'sequence' && mode !== 'repeat-one' && mode !== 'shuffle') return
      if (get().mode === mode) return
      set({ mode })
      if (mode === 'shuffle') resetShuffle(get().queue.length, get().index)
    },

    async retryWithAlternateSource() {
      const state = get()
      const song = state.current
      const index = state.index
      const previousReason = state.message.trim()
      const fail = (reason: string): void => {
        const message = previousReason ? `${previousReason}；${reason}` : reason
        set({ status: 'error', message })
        updatePlaybackState('none')
      }
      if (!song || index < 0 || !state.queue[index]) {
        fail('当前没有可重试的歌曲')
        return
      }
      if (song.type === 'local' || song.type === 'podcast' || String(song.source) === 'podcast') {
        fail('当前歌曲不支持备用音源重试')
        return
      }
      const path = alternateSearchPath(song)
      if (!path) {
        fail('当前歌曲缺少可用于匹配备用音源的信息')
        return
      }

      const generation = ++loadGeneration
      audio.pause()
      set({ status: 'loading' })
      const targetLabel = providerLabel(alternateProvider(song.provider))
      setNotice(`正在查找${targetLabel}的同名同歌手版本…`)
      try {
        const data = await apiJson<{ songs?: UnifiedSong[] }>(path)
        if (stale(generation)) return
        if (!data || !Array.isArray(data.songs)) {
          fail('备用音源搜索失败')
          return
        }
        const alternate = pickAlternateSong(song, data.songs)
        if (!alternate) {
          fail(`未找到同名同歌手的${targetLabel}版本`)
          return
        }
        const queue = get().queue.slice()
        queue[index] = alternate
        set({ queue })
        setNotice(`已切换备用音源：${song.name || '当前歌曲'} → ${targetLabel}`)
        await loadIndex(index, {
          manual: true,
          fallbackDepth: 1,
          disableAlternateRetry: true,
        })
      } catch (error) {
        if (stale(generation)) return
        const reason = error instanceof Error && error.message ? error.message : '备用音源搜索失败'
        fail(`备用音源搜索失败：${reason}`)
      }
    },

    async next() {
      const { index, mode, queue } = get()
      if (!queue.length) return
      // repeat-one only affects natural ended; explicit transport controls always move.
      const currentIndex = index >= 0 && index < queue.length ? index : -1
      const nextIndex = mode === 'shuffle' ? nextShuffleIndex() : (currentIndex + 1) % queue.length
      if (nextIndex < 0) return
      set({ notice: '' })
      await loadIndex(nextIndex, {})
    },

    async prev() {
      const { index, mode, queue } = get()
      if (!queue.length) return
      const currentIndex = index >= 0 && index < queue.length ? index : 0
      const previousIndex =
        mode === 'shuffle' ? previousShuffleIndex() : (currentIndex - 1 + queue.length) % queue.length
      if (previousIndex < 0) return
      set({ notice: '' })
      await loadIndex(previousIndex, {})
    },

    toggle() {
      const { status, index } = get()
      if (status === 'playing') audio.pause()
      else if (status === 'paused') resumePlayback()
      // 失败终态给用户一个恢复出口：播放键 = 重试当前曲目
      else if (status === 'error' && index >= 0) void loadIndex(index, { manual: true })
    },

    setVolume(value) {
      const volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_VOLUME
      audio.volume = volume
      set({ volume })
      persistVolume(volume)
    },

    seek(ratio) {
      const duration = activeTrialLimitSeconds ?? audio.duration
      if (!Number.isFinite(duration) || duration <= 0) return
      audio.currentTime = Math.max(0, Math.min(1, ratio)) * duration
    },

    syncProgress() {
      // 取链窗口期 audio 里还是旧曲，进度无意义（会把旧曲时间配到新歌标题上）
      if (get().status === 'loading') return
      const mediaDuration = Number.isFinite(audio.duration) ? audio.duration : get().duration
      const dur =
        activeTrialLimitSeconds === null
          ? mediaDuration
          : Math.min(mediaDuration || activeTrialLimitSeconds, activeTrialLimitSeconds)
      // 进度取 0.1s 粒度：空闲帧零通知，播放中通知从帧率降到 10Hz，肉眼无差
      const rawPosition =
        activeTrialLimitSeconds === null
          ? audio.currentTime || 0
          : Math.min(audio.currentTime || 0, activeTrialLimitSeconds)
      const pos = Math.round(rawPosition * 10) / 10
      const durOut = dur || 0
      const prev = get()
      if (prev.position === pos && prev.duration === durOut) return
      set({ position: pos, duration: durOut })
      // MediaSession 位置只需在不连续点更新：按整秒/时长变化节流，避免每帧跨进程 IPC
      const second = Math.floor(pos)
      if (second !== lastPositionSecondPushed || durOut !== lastDurationPushed) {
        lastPositionSecondPushed = second
        lastDurationPushed = durOut
        updatePositionState(pos, durOut)
      }
    },
  }
})

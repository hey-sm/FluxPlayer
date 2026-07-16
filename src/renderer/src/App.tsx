import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProviderId, QualityLevel, UnifiedPlaylist, UnifiedSong } from '@shared/models'
import type { CustomBackground, WallpaperEngineProject } from '@shared/custom-background-contract'
import { apiJson, coverProxyUrl, normalizeCoverSource } from './api'
import { usePlayer } from './stores/player'
import { useAuth } from './stores/auth'
import { searchPath } from './playback/match'
import { ticker } from './perf/ticker'
import { StageCanvas } from './visual/StageCanvas'
import { visualBus, type VisualPreset } from './visual/bus'
import { stageLyricsChannel } from './visual/scene'
import { VISUAL_PRESETS, VISUAL_PRESET_BY_ID } from './visual/presets/registry'
import {
  attach as attachVisualAudio,
  resume as resumeVisualAudio,
  start as startVisualAudio,
  stop as stopVisualAudio,
} from './visual/audio'
import { Alert, AlertDescription } from './components/ui/alert'
import { Card } from './components/ui/card'
import { Input } from './components/ui/input'
import { GlassSelect } from './components/ui/glass-select'
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs'
import { AppTopBar, type ActiveSheet } from './components/shell/AppTopBar'
import { LibrarySheet } from './components/shell/LibrarySheet'
import { PlaylistDetailSheet } from './components/shell/PlaylistDetailSheet'
import { SettingsDialog } from './components/shell/SettingsDialog'
import {
  CLASSIC_GLASS_CSS_VARIABLES,
  CLASSIC_GLASS_FILTER_ID,
  CLASSIC_GLASS_FILTER_SVG,
  CLASSIC_GLASS_MAP_ID,
  createClassicGlassDisplacementSvg,
  useThemeStore,
} from './theme'
import {
  calculateWindow,
  clearPlaylistIdentity,
  fetchPlaylistTracks,
  fetchPlaylists,
  playlistQueryKeys,
} from './features/playlist'
import { useLyrics } from './features/lyrics'
import { SystemMaintenancePanel } from './features/system/SystemMaintenancePanel'
import { fetchLikedTracks, readRecentPlays, recordRecentPlay, subscribeRecentPlays } from './features/library'
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon, RepeatIcon, RepeatOneIcon, ShuffleIcon } from './components/Icons'

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

const PROVIDER_ORDER_KEY = 'fluxplayer-search-provider-order-v1'

function readProviderOrder(): ProviderId[] {
  try {
    const value = JSON.parse(localStorage.getItem(PROVIDER_ORDER_KEY) || 'null')
    if (Array.isArray(value) && value.length === 2 && value.includes('netease') && value.includes('qq')) return value
  } catch { /* use stable default */ }
  return ['netease', 'qq']
}


/** 账号区：按当前 provider 显示对应登录态 / 登录按钮 */
function AccountArea({ provider }: { provider: ProviderId }) {
  const { netease, qq, neteaseBusy, qqBusy, message, loginNetease, logoutNetease, loginQQ, logoutQQ } =
    useAuth()
  const desktop = window.fluxDesktop
  if (!desktop) return null

  const busy = provider === 'qq' ? qqBusy : neteaseBusy

  if (provider === 'qq') {
    if (qq?.loggedIn) {
      const partial = qq.playbackKeyReady === false
      return (
        <div className="account">
          {qq.avatar ? <img className="avatar" src={coverProxyUrl(qq.avatar)} alt="" /> : null}
          <span className="nick">{qq.nickname || (qq.preview ? '待接入' : 'QQ 用户')}</span>
          {qq.vipType ? <span className="vip">VIP</span> : null}
          {partial ? (
            <span className="warn" title="播放授权不完整，部分歌曲将自动换源">
              授权不完整
            </span>
          ) : null}
          <button className="logout" disabled={qqBusy} onClick={() => void logoutQQ()}>
            登出
          </button>
        </div>
      )
    }
    return (
      <div className="account">
        {message ? <span className="hint">{message}</span> : null}
        <button className="login" disabled={busy} onClick={() => void loginQQ()}>
          {busy ? '登录中…' : '登录 QQ'}
        </button>
      </div>
    )
  }

  if (netease?.loggedIn) {
    return (
      <div className="account">
        {netease.avatar ? <img className="avatar" src={coverProxyUrl(netease.avatar)} alt="" /> : null}
        <span className="nick">{netease.nickname || '网易云用户'}</span>
        {netease.isVip ? <span className="vip">{netease.vipLabel || 'VIP'}</span> : null}
        <button className="logout" disabled={neteaseBusy} onClick={() => void logoutNetease()}>
          登出
        </button>
      </div>
    )
  }
  return (
    <div className="account">
      {message ? <span className="hint">{message}</span> : null}
      <button className="login" disabled={busy} onClick={() => void loginNetease()}>
        {busy ? '登录中…' : '登录网易云'}
      </button>
    </div>
  )
}

function ThemePanel({
  open,
  onClose,
  visualPreset,
  onVisualPresetChange,
  customBackground,
  backgroundBusy,
  backgroundError,
  wallpaperProjects,
  onChooseBackground,
  onClearBackground,
  onScanWallpaperEngine,
  onChooseWallpaperEngine,
  onImportWallpaperEngine,
  motionStyle,
  onMotionStyleChange,
}: {
  open: boolean
  onClose(): void
  visualPreset: VisualPreset
  onVisualPresetChange(preset: VisualPreset): void
  customBackground: CustomBackground | null
  backgroundBusy: boolean
  backgroundError: string
  wallpaperProjects: WallpaperEngineProject[]
  onChooseBackground(): void
  onClearBackground(): void
  onScanWallpaperEngine(): void
  onChooseWallpaperEngine(): void
  onImportWallpaperEngine(projectId: string): void
  motionStyle: string
  onMotionStyleChange(style: string): void
}) {
  const [activeTab, setActiveTab] = useState<'appearance' | 'system'>('appearance')
  if (!open) return null

  const activeVisualPreset = VISUAL_PRESET_BY_ID.get(visualPreset)
  return (
    <SettingsDialog open={open} wide={activeTab === 'system'} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <Card className="theme-panel border-0 bg-transparent shadow-none">
          <header>
            <div>
              <strong>主题设置</strong>
              <p>主题变量会实时应用并自动保存。</p>
            </div>
          </header>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
          <TabsList className="settings-tabs" aria-label="设置分类">
            <TabsTrigger value="appearance">外观</TabsTrigger>
            <TabsTrigger value="system">系统</TabsTrigger>
          </TabsList>

          {activeTab === 'appearance' ? <>
          <div className="theme-field">
            <span>界面动效</span>
            <GlassSelect
              value={motionStyle}
              ariaLabel="界面动效"
              className="theme-select-trigger"
              contentClassName="theme-select-menu"
              options={[
                { value: 'glide', label: '丝滑滑入' },
                { value: 'spring', label: '弹性浮现' },
                { value: 'fade', label: '柔和淡入' },
                { value: 'scale', label: '景深缩放' },
              ]}
              onValueChange={onMotionStyleChange}
            />
            <small>统一应用于搜索、歌单、歌曲列表和列表项目。</small>
          </div>

          <div className="theme-field">
            <span>音乐视觉</span>
            <GlassSelect
              value={String(visualPreset)}
              ariaLabel="音乐视觉"
              className="theme-select-trigger"
              contentClassName="theme-select-menu"
              options={VISUAL_PRESETS.map((preset) => ({ value: String(preset.id), label: preset.label }))}
              onValueChange={(value) => onVisualPresetChange(Number(value) as VisualPreset)}
            />
            <small>{activeVisualPreset?.description}</small>
          </div>

          <section className="custom-background-settings" aria-label="自定义背景">
            <div className="custom-background-heading">
              <span><strong>自定义背景</strong><small>图片或静音循环视频；启用后替换音乐视觉并保留 3D 歌词</small></span>
              {customBackground ? <em>{customBackground.source === 'wallpaper-engine' ? 'Wallpaper Engine' : '本地文件'}</em> : null}
            </div>
            <div className="custom-background-current">{customBackground ? customBackground.name : '当前使用主题视觉背景'}</div>
            <div className="custom-background-actions">
              <button type="button" disabled={backgroundBusy} onClick={onChooseBackground}>选择图片 / 视频</button>
              <button type="button" disabled={backgroundBusy} onClick={onScanWallpaperEngine}>扫描 Wallpaper Engine</button>
              <button type="button" disabled={backgroundBusy} onClick={onChooseWallpaperEngine}>手选 WE 项目</button>
              {customBackground ? <button type="button" disabled={backgroundBusy} onClick={onClearBackground}>清除</button> : null}
            </div>
            {wallpaperProjects.length ? <div className="wallpaper-project-list" data-scroll-region>{wallpaperProjects.map((project) => (
              <button type="button" key={project.id} disabled={backgroundBusy} onClick={() => onImportWallpaperEngine(project.id)}>
                <span className="wallpaper-project-preview">{project.previewUrl ? <img src={project.previewUrl} alt="" loading="lazy" /> : null}</span>
                <span className="wallpaper-project-title">{project.title}<small>视频</small></span>
              </button>
            ))}</div> : null}
            {backgroundError ? <Alert variant="destructive" className="custom-background-error"><AlertDescription>{backgroundError}</AlertDescription></Alert> : null}
          </section>

          </> : <SystemMaintenancePanel />}
          </Tabs>
      </Card>
    </SettingsDialog>
  )
}

/** 降档/换源/跳歌进程气泡（store 侧 5 秒自动清空），对应旧 source-fallback-notice */
function FallbackNotice() {
  const notice = usePlayer((s) => s.notice)
  if (!notice) return null
  return <div className="fallback-notice">{notice}</div>
}

/** 独立订阅 10Hz 播放进度，避免整棵 App 随歌词高亮重渲染。 */
function StageLyricsSynchronizer() {
  const current = usePlayer((state) => state.current)
  const position = usePlayer((state) => state.position)
  const accentColor = useThemeStore((state) => state.visualParams.accent)
  const lyrics = useLyrics(current)
  const lines = useMemo(() => lyrics.data?.lines ?? [], [lyrics.data?.lines])

  useEffect(() => {
    stageLyricsChannel.set({
      trackKey: lyrics.trackKey,
      lines,
      position,
      accentColor,
      visible: lyrics.loadState === 'success',
    })
  }, [accentColor, lines, lyrics.loadState, lyrics.trackKey, position])

  useEffect(() => () => stageLyricsChannel.set({
    trackKey: null,
    lines: [],
    position: 0,
    accentColor: '#7c8cff',
    visible: false,
  }), [])
  return null
}

function supportsClassicControlGlass(): boolean {
  try {
    const probe = document.createElement('div')
    probe.style.backdropFilter = `url(#${CLASSIC_GLASS_FILTER_ID})`
    return probe.style.backdropFilter !== ''
  } catch {
    return false
  }
}

function useClassicControlGlass(
  enabled: boolean,
  filterId = CLASSIC_GLASS_FILTER_ID,
  mapId = CLASSIC_GLASS_MAP_ID,
  readyClass = 'classic-control-glass-svg-ok',
) {
  const controlRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove(readyClass)
    if (!enabled || !controlRef.current) return

    for (const [name, value] of Object.entries(CLASSIC_GLASS_CSS_VARIABLES)) {
      root.style.setProperty(name, value)
    }
    if (!supportsClassicControlGlass()) return

    const control = controlRef.current
    const image = document.getElementById(mapId)
    if (!image) return
    let sizeKey = ''
    const updateMap = (): void => {
      const rect = control.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return
      const radius = Number.parseFloat(getComputedStyle(control).borderRadius) || 50
      const nextKey = `${Math.round(rect.width)}x${Math.round(rect.height)}:${Math.round(radius)}`
      if (nextKey === sizeKey) return
      sizeKey = nextKey
      const href = `data:image/svg+xml,${encodeURIComponent(
        createClassicGlassDisplacementSvg(rect.width, rect.height, radius),
      )}`
      image.setAttribute('href', href)
      image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href)
    }

    root.classList.add(readyClass)
    updateMap()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMap)
    observer?.observe(control)
    return () => {
      observer?.disconnect()
      root.classList.remove(readyClass)
    }
  }, [enabled, filterId, mapId, readyClass])

  return controlRef
}


const QUALITY_LABELS: Readonly<Record<QualityLevel, string>> = {
  standard: '标准',
  exhigh: '极高',
  lossless: '无损',
  hires: 'Hi-Res',
  jymaster: '臻品',
}

function QualityMenu({
  provider,
  preference,
  resolved,
  onChange,
}: {
  provider: ProviderId
  preference: QualityLevel
  resolved: QualityLevel | null
  onChange(value: QualityLevel): Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const options: readonly QualityLevel[] = provider === 'qq'
    ? ['hires', 'lossless', 'exhigh', 'standard']
    : ['jymaster', 'hires', 'lossless', 'exhigh', 'standard']
  const actual = resolved ?? preference

  return (
    <GlassSelect
      value={preference}
      ariaLabel="选择播放音质"
      title={`当前音质：${QUALITY_LABELS[actual]}`}
      disabled={busy}
      side="top"
      className="quality-trigger"
      contentClassName="quality-menu"
      options={options.map((quality) => ({
        value: quality,
        label: QUALITY_LABELS[quality],
        trailing: actual === quality ? '当前' : undefined,
      }))}
      renderValue={() => (
        <>
          {QUALITY_LABELS[actual]}
          {!resolved ? <small>待确认</small> : resolved !== preference ? <small>已降档</small> : null}
        </>
      )}
      onValueChange={(value) => {
        if (busy) return
        setBusy(true)
        void onChange(value as QualityLevel).finally(() => setBusy(false))
      }}
    />
  )
}

function PlayerBar() {
  const {
    current,
    status,
    message,
    position,
    duration,
    queue,
    toggle,
    seek,
    next,
    prev,
    syncProgress,
    mode,
    setMode,
    retryWithAlternateSource,
    qualityPreference,
    resolvedQuality,
    setQualityPreference,
  } = usePlayer()
  const classicTheme = useThemeStore((state) => state.selectedPresetId === 'classic-gold')
  const controlGlassRef = useClassicControlGlass(classicTheme && Boolean(current))

  // 进度刷新走全局 Ticker：suspended（最小化）时自动停更，音频不受影响
  useEffect(() => ticker.add(() => syncProgress()), [syncProgress])

  if (!current) return null
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0
  const hasQueue = queue.length > 0
  const nextMode = mode === 'sequence' ? 'repeat-one' : mode === 'repeat-one' ? 'shuffle' : 'sequence'
  const modeLabel = mode === 'sequence' ? '列表循环' : mode === 'repeat-one' ? '单曲循环' : '随机播放'
  const playerMessage = status === 'loading'
    ? '取链中…'
    : message.startsWith('音质：')
      ? ''
      : message
  return (
    <div
      ref={controlGlassRef}
      className={`playerbar glass-surface${classicTheme ? ' classic-control-glass' : ''}`}
    >
      {classicTheme ? (
        <svg className="control-glass-filter-svg" aria-hidden="true" focusable="false">
          <defs dangerouslySetInnerHTML={{ __html: CLASSIC_GLASS_FILTER_SVG }} />
        </svg>
      ) : null}
      <button className="nav-btn" title="上一首" aria-label="上一首" disabled={!hasQueue} onClick={() => void prev()}><PreviousIcon /></button>
      <button className="play-btn" aria-label={status === 'playing' ? '暂停' : '播放'} onClick={toggle}>{status === 'playing' ? <PauseIcon /> : <PlayIcon />}</button>
      <button className="nav-btn" title="下一首" aria-label="下一首" disabled={!hasQueue} onClick={() => void next()}><NextIcon /></button>
      <button
        className="mode-btn"
        title={`播放模式：${modeLabel}（点击切换）`}
        aria-label={`播放模式：${modeLabel}`}
        onClick={() => setMode(nextMode)}
      >
        {mode === 'sequence' ? <RepeatIcon /> : mode === 'repeat-one' ? <RepeatOneIcon /> : <ShuffleIcon />}
      </button>
      <QualityMenu
        provider={current.provider}
        preference={qualityPreference}
        resolved={resolvedQuality}
        onChange={setQualityPreference}
      />
      <div className="info">
        <div className="name">
          {current.name} — {current.artist}
        </div>
        {playerMessage || status === 'error' ? (
          <div className={`status${status === 'error' ? ' error' : ''}`}>
            <span>{playerMessage || '播放失败'}</span>
            {status === 'error' ? (
              <button type="button" className="retry-source" onClick={() => void retryWithAlternateSource()}>
                换源重试
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div
        className="progress"
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
          seek((e.clientX - rect.left) / rect.width)
        }}
      >
        <div className="fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="time">
        {formatTime(position)} / {formatTime(duration)}
      </span>
    </div>
  )
}

type BackgroundMode = 'visual' | 'wallpaper'

const VISUAL_PRESET_KEY = 'fluxplayer-visual-preset-v1'

function initialVisualPreset(): VisualPreset {
  try {
    const raw = localStorage.getItem(VISUAL_PRESET_KEY)
    if (raw === null) return 2
    const value = Number(raw)
    return VISUAL_PRESET_BY_ID.has(value as VisualPreset) ? (value as VisualPreset) : 2
  } catch {
    return 2
  }
}

const playlistCacheKey = (provider: ProviderId, identity: string) =>
  `flux-playlist-cache:${provider}:${identity}`

type PersistentPlaylistCache = {
  playlists: UnifiedPlaylist[]
  tracks: Record<string, UnifiedSong[]>
}

function readPersistentPlaylistCache(provider: ProviderId, identity: string): PersistentPlaylistCache | undefined {
  if (!identity) return undefined
  try {
    const parsed = JSON.parse(localStorage.getItem(playlistCacheKey(provider, identity)) ?? '') as PersistentPlaylistCache
    return Array.isArray(parsed.playlists) && parsed.tracks && typeof parsed.tracks === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

function writePersistentPlaylistCache(provider: ProviderId, identity: string, cache: PersistentPlaylistCache): void {
  try {
    localStorage.setItem(playlistCacheKey(provider, identity), JSON.stringify(cache))
  } catch {
    // Storage quota exhaustion must not break playback or the live query cache.
  }
}

function PlaylistCoverImage({ candidates, className }: { candidates: readonly string[]; className?: string }) {
  const sources = useMemo(() => {
    const unique = new Set<string>()
    for (const candidate of candidates) {
      const source = normalizeCoverSource(candidate)
      if (!source) continue
      const proxied = coverProxyUrl(source)
      if (proxied) unique.add(proxied)
      unique.add(source)
    }
    return [...unique]
  }, [candidates])
  const [sourceIndex, setSourceIndex] = useState(0)
  if (!sources[sourceIndex]) return <span className={className} aria-hidden="true" />
  return (
    <img
      className={className}
      src={sources[sourceIndex]}
      alt=""
      loading="lazy"
      onError={() => setSourceIndex((index) => index + 1)}
    />
  )
}

interface ShelfPlaylistDetail {
  readonly provider: ProviderId
  readonly identityToken: string
  readonly playlist: UnifiedPlaylist
  readonly tracks: readonly UnifiedSong[]
  readonly status: 'loading' | 'success' | 'error'
  readonly error?: string
}

const SHELF_DETAIL_ROW_HEIGHT = 58

function ShelfDetailPanel({
  detail,
  onPlay,
}: {
  detail: ShelfPlaylistDetail
  onPlay(songs: readonly UnifiedSong[], index: number): void
}) {
  const [scrollTop, setScrollTop] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [viewportHeight, setViewportHeight] = useState(() => Math.max(220, window.innerHeight - 150))

  useEffect(() => {
    if (detail.tracks.length === 0) return
    const list = listRef.current
    if (!list) return
    const syncViewportHeight = (): void => setViewportHeight(Math.max(1, list.clientHeight))
    syncViewportHeight()
    const resizeObserver = new ResizeObserver(syncViewportHeight)
    resizeObserver.observe(list)
    return () => resizeObserver.disconnect()
  }, [detail.tracks.length])

  const windowSlice = useMemo(
    () =>
      calculateWindow(
        detail.tracks.length,
        scrollTop,
        viewportHeight,
        SHELF_DETAIL_ROW_HEIGHT,
        3,
      ),
    [detail.tracks.length, scrollTop, viewportHeight],
  )
  const visibleTracks = detail.tracks.slice(windowSlice.start, windowSlice.end)

  return (
    <aside className="shelf-detail-panel glass-surface" aria-label={`${detail.playlist.name}歌曲`}>
      <header>
        <PlaylistCoverImage
          key={`${detail.playlist.id}:${detail.playlist.cover}:${detail.tracks[0]?.cover ?? ''}`}
          candidates={[detail.playlist.cover || '', detail.tracks.find((track) => track.cover)?.cover || '']}
          className="shelf-detail-cover"
        />
        <div>
          <strong>{detail.playlist.name}</strong>
          <small>
            {detail.playlist.creator ? `${detail.playlist.creator} · ` : ''}
            {detail.playlist.trackCount} 首
          </small>
        </div>
      </header>
      {detail.status === 'loading' ? <div className="shelf-detail-status">正在加载歌曲…</div> : null}
      {detail.status === 'error' ? (
        <div className="shelf-detail-status error" role="alert">
          {detail.error || '歌单加载失败'}
        </div>
      ) : null}
      {detail.status === 'success' && detail.tracks.length === 0 ? (
        <div className="shelf-detail-status">歌单中暂无歌曲</div>
      ) : null}
      {detail.tracks.length > 0 ? (
        <div
          ref={listRef}
          className="shelf-detail-list"
          data-scroll-region
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div aria-hidden="true" style={{ height: windowSlice.offsetTop }} />
          {visibleTracks.map((song, relativeIndex) => {
            const index = windowSlice.start + relativeIndex
            return (
              <button
                key={`${detail.provider}:${song.id}:${index}`}
                type="button"
                className="shelf-detail-row"
                style={{ height: SHELF_DETAIL_ROW_HEIGHT }}
                onClick={() => onPlay(detail.tracks, index)}
              >
                {song.cover ? <img src={coverProxyUrl(song.cover)} alt="" loading="lazy" /> : <span />}
                <span>
                  <strong>{song.name}</strong>
                  <small>{song.artist || '未知歌手'}</small>
                </span>
              </button>
            )
          })}
          <div aria-hidden="true" style={{ height: windowSlice.offsetBottom }} />
        </div>
      ) : null}
    </aside>
  )
}
export default function App() {
  const classicTheme = useThemeStore((state) => state.selectedPresetId === 'classic-gold')
  const searchGlassRef = useClassicControlGlass(
    classicTheme,
    'flux-classic-search-glass-filter',
    'flux-classic-search-glass-map',
    'classic-search-glass-svg-ok',
  )
  const [keyword, setKeyword] = useState('')
  const [visualPreset, setVisualPreset] = useState<VisualPreset>(initialVisualPreset)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [providerOrder, setProviderOrder] = useState<ProviderId[]>(readProviderOrder)
  const [provider, setProvider] = useState<ProviderId>(() => readProviderOrder()[0])
  const [searchOpen, setSearchOpen] = useState(false)
  const [draggedProvider, setDraggedProvider] = useState<ProviderId | null>(null)
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null)
  const [motionStyle, setMotionStyle] = useState(() => localStorage.getItem('flux-ui-motion') || 'glide')
  const [customBackground, setCustomBackground] = useState<CustomBackground | null>(null)
  const [backgroundMediaFailed, setBackgroundMediaFailed] = useState(false)
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const [backgroundError, setBackgroundError] = useState('')
  const [wallpaperProjects, setWallpaperProjects] = useState<WallpaperEngineProject[]>([])
  const [recentTracks, setRecentTracks] = useState<UnifiedSong[]>([])
  const debouncedKeyword = useDebounced(keyword.trim(), 320)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  // 用 selector 精确订阅：无 selector 的全量订阅会被 syncProgress 的高频 set() 放大成整树重渲染
  const current = usePlayer((s) => s.current)
  const playerStatus = usePlayer((s) => s.status)
  const playerAudio = usePlayer((s) => s.audio)
  const setQueue = usePlayer((s) => s.setQueue)
  const accentColor = useThemeStore((s) => s.visualParams.accent)
  const refreshAll = useAuth((s) => s.refreshAll)
  const neteaseAuth = useAuth((s) => s.netease)
  const qqAuth = useAuth((s) => s.qq)
  const qqLoggedIn = qqAuth?.loggedIn === true
  const startQQPolling = useAuth((s) => s.startQQPolling)
  const queryClient = useQueryClient()
  const neteaseIdentity = neteaseAuth?.loggedIn && neteaseAuth.userId ? `user:${neteaseAuth.userId}` : ''
  const qqIdentity = qqAuth?.loggedIn && qqAuth.userId ? `uin:${qqAuth.userId}` : ''
  const previousIdentities = useRef<Record<ProviderId, string>>({ netease: '', qq: '' })
  const activeIdentity = provider === 'qq' ? qqIdentity : neteaseIdentity
  const activeUserId = provider === 'qq' ? qqAuth?.userId : neteaseAuth?.userId
  const recentIdentity = useMemo(() => ({ provider, userId: activeUserId }), [activeUserId, provider])
  const shelfLoggedIn = provider === 'qq' ? qqAuth?.loggedIn === true : neteaseAuth?.loggedIn === true
  const shelfScope = `${provider}:${activeIdentity}`
  const [shelfDetail, setShelfDetail] = useState<ShelfPlaylistDetail | null>(null)
  const [playlistCoverFallbacks, setPlaylistCoverFallbacks] = useState<Record<string, string[]>>({})
  const shelfRequestGeneration = useRef(0)
  const restoredPlaylistScope = useRef('')
  const currentShelfScope = useRef(shelfScope)
  const shelfPlaylistsQuery = useQuery({
    queryKey: playlistQueryKeys.list(provider, activeIdentity, 120),
    queryFn: () => fetchPlaylists(provider, 120),
    enabled: shelfLoggedIn && activeIdentity.length > 0,
    initialData: () => {
      const cached = readPersistentPlaylistCache(provider, activeIdentity)
      return cached ? { provider, loggedIn: true, playlists: cached.playlists } : undefined
    },
    staleTime: 5 * 60 * 1000,
  })
  const shelfPlaylists = useMemo(
    () => shelfPlaylistsQuery.data?.playlists ?? [],
    [shelfPlaylistsQuery.data?.playlists],
  )


  // 登录后立即后台加载并持久化每个歌单的歌曲；点击歌单只读取内存/本地缓存。
  useEffect(() => {
    if (!shelfLoggedIn || !activeIdentity || shelfPlaylists.length === 0) return
    let cancelled = false
    const persisted = readPersistentPlaylistCache(provider, activeIdentity) ?? { playlists: [], tracks: {} }
    persisted.playlists = [...shelfPlaylists]
    const restoredCovers: Record<string, string[]> = {}
    for (const playlist of shelfPlaylists) {
      const firstCover = persisted.tracks[String(playlist.id)]?.find((track) => track.cover)?.cover
      if (firstCover) restoredCovers[String(playlist.id)] = [firstCover]
    }
    queueMicrotask(() => setPlaylistCoverFallbacks(restoredCovers))
    for (const playlist of shelfPlaylists) {
      const cachedTracks = persisted.tracks[String(playlist.id)]
      if (cachedTracks) {
        queryClient.setQueryData(
          playlistQueryKeys.tracks(provider, activeIdentity, playlist.id),
          { provider, loggedIn: true, playlist, tracks: cachedTracks },
        )
      }
    }
    writePersistentPlaylistCache(provider, activeIdentity, persisted)

    void (async () => {
      for (const playlist of shelfPlaylists) {
        if (cancelled) return
        const key = playlistQueryKeys.tracks(provider, activeIdentity, playlist.id)
        if (queryClient.getQueryData(key)) continue
        try {
          const result = await queryClient.fetchQuery({
            queryKey: key,
            queryFn: () => fetchPlaylistTracks(provider, playlist.id),
            staleTime: Number.POSITIVE_INFINITY,
          })
          persisted.tracks[String(playlist.id)] = [...result.tracks]
          const detailCover = result.playlist?.cover || ''
          const firstCover = result.tracks.find((track) => track.cover)?.cover || ''
          if (detailCover || firstCover) {
            setPlaylistCoverFallbacks((current) => ({
              ...current,
              [String(playlist.id)]: [detailCover, firstCover].filter(Boolean),
            }))
          }
          if (detailCover) {
            persisted.playlists = persisted.playlists.map((item) =>
              String(item.id) === String(playlist.id) ? { ...item, cover: detailCover } : item,
            )
          }
          writePersistentPlaylistCache(provider, activeIdentity, persisted)
        } catch {
          // Keep warming the remaining playlists when one provider request fails.
        }
      }
    })()
    return () => { cancelled = true }
  }, [activeIdentity, provider, queryClient, shelfLoggedIn, shelfPlaylists])

  // 登录身份变化时清掉旧账号歌单缓存，避免登出或切号后闪现旧数据。
  useEffect(() => {
    const currentIdentities: Record<ProviderId, string> = { netease: neteaseIdentity, qq: qqIdentity }
    for (const candidate of ['netease', 'qq'] as const) {
      const previous = previousIdentities.current[candidate]
      if (previous && previous !== currentIdentities[candidate]) {
        void clearPlaylistIdentity(queryClient, candidate, previous)
      }
    }
    previousIdentities.current = currentIdentities
  }, [neteaseIdentity, qqIdentity, queryClient])

  useEffect(() => {
    currentShelfScope.current = shelfScope
    shelfRequestGeneration.current += 1
  }, [shelfScope])

  const closeShelfDetail = useCallback(() => {
    shelfRequestGeneration.current += 1
    setShelfDetail(null)
  }, [])

  const handleShelfAction = useCallback(
    (index: number) => {
      if (!activeIdentity) return

      const playlist = shelfPlaylists[index]
      if (!playlist) return
      const requestGeneration = ++shelfRequestGeneration.current
      setShelfDetail({
        provider,
        identityToken: activeIdentity,
        playlist,
        tracks: [],
        status: 'loading',
      })

      void queryClient
        .fetchQuery({
          queryKey: playlistQueryKeys.tracks(provider, activeIdentity, playlist.id),
          queryFn: () => fetchPlaylistTracks(provider, playlist.id),
          staleTime: Number.POSITIVE_INFINITY,
        })
        .then((result) => {
          if (
            requestGeneration !== shelfRequestGeneration.current ||
            currentShelfScope.current !== shelfScope
          )
            return
          setShelfDetail({
            provider,
            identityToken: activeIdentity,
            playlist: result.playlist ?? playlist,
            tracks: result.tracks,
            status: 'success',
          })
        })
        .catch((error: unknown) => {
          if (
            requestGeneration !== shelfRequestGeneration.current ||
            currentShelfScope.current !== shelfScope
          )
            return
          setShelfDetail({
            provider,
            identityToken: activeIdentity,
            playlist,
            tracks: [],
            status: 'error',
            error: error instanceof Error ? error.message : '歌单加载失败',
          })
        })
    },
    [activeIdentity, provider, queryClient, shelfPlaylists, shelfScope],
  )

  useEffect(() => {
    if (!activeIdentity || shelfPlaylists.length === 0 || restoredPlaylistScope.current === shelfScope) return
    restoredPlaylistScope.current = shelfScope
    const savedId = localStorage.getItem(`flux-last-playlist:${provider}:${activeIdentity}`)
    const index = savedId ? shelfPlaylists.findIndex((playlist) => String(playlist.id) === savedId) : -1
    if (index < 0) return
    queueMicrotask(() => handleShelfAction(index))
  }, [activeIdentity, handleShelfAction, provider, shelfPlaylists, shelfScope])

  const openLibraryTracks = useCallback((title: string, tracks: UnifiedSong[], tag: string) => {
    const playlist: UnifiedPlaylist = { id: `flux:${tag}`, name: title, cover: tracks[0]?.cover || '', trackCount: tracks.length, tag }
    setShelfDetail({ provider, identityToken: activeIdentity || 'guest', playlist, tracks, status: 'success' })
    setActiveSheet('detail')
  }, [activeIdentity, provider])

  const openLikedTracks = useCallback(() => {
    if (!shelfLoggedIn) return
    const generation = ++shelfRequestGeneration.current
    const placeholder: UnifiedPlaylist = { id: 'flux:liked', name: '我的喜欢', cover: '', trackCount: 0 }
    setShelfDetail({ provider, identityToken: activeIdentity, playlist: placeholder, tracks: [], status: 'loading' })
    setActiveSheet('detail')
    void fetchLikedTracks(provider, { limit: 200 }).then((result) => {
      if (generation === shelfRequestGeneration.current) openLibraryTracks('我的喜欢', result.tracks, '平台收藏')
    }).catch((error: unknown) => {
      if (generation === shelfRequestGeneration.current) setShelfDetail({ provider, identityToken: activeIdentity, playlist: placeholder, tracks: [], status: 'error', error: error instanceof Error ? error.message : '喜欢歌曲加载失败' })
    })
  }, [activeIdentity, openLibraryTracks, provider, shelfLoggedIn])

  const openRecentTracks = useCallback(() => openLibraryTracks('最近播放', recentTracks, 'FluxPlayer 记录'), [openLibraryTracks, recentTracks])

  // 启动时并发拉两个登录态
  useEffect(() => {
    void refreshAll()
  }, [refreshAll])
  useEffect(() => {
    if (!qqLoggedIn) return
    return startQQPolling()
  }, [qqLoggedIn, startQQPolling])

  // 即使初始化登录态请求在卸载后才返回，也要阻止它遗留轮询。
  useEffect(() => () => useAuth.getState().stopQQPolling(), [])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) setRecentTracks(readRecentPlays(recentIdentity).map((entry) => entry.track))
    })
    const unsubscribe = subscribeRecentPlays(recentIdentity, (entries) => setRecentTracks(entries.map((entry) => entry.track)))
    return () => { active = false; unsubscribe() }
  }, [recentIdentity])

  useEffect(() => {
    if (!current || playerStatus !== 'playing') return
    recordRecentPlay({ provider: current.provider, userId: current.provider === 'qq' ? qqAuth?.userId : neteaseAuth?.userId }, current)
  }, [current, neteaseAuth?.userId, playerStatus, qqAuth?.userId])

  useEffect(() => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    void desktop.getCustomBackground().then((result) => { if (result.ok) setCustomBackground(result.background) })
    return desktop.onCustomBackgroundChanged((result) => { if (result.ok) setCustomBackground(result.background) })
  }, [])

  useEffect(() => {
    setBackgroundMediaFailed(false)
  }, [customBackground?.url])

  useEffect(() => {
    try {
      localStorage.setItem(VISUAL_PRESET_KEY, String(visualPreset))
    } catch {
      // 隐私模式/存储不可用时仅保持本次会话状态。
    }
  }, [visualPreset])
  // React 只向视觉引擎推送低频状态；频谱帧由 WebAudio/Ticker 直接写 VisualBus。
  useEffect(() => {
    visualBus.setPlaybackState(playerStatus)
    if (playerStatus === 'playing') void resumeVisualAudio()
  }, [playerStatus])

  useEffect(() => {
    visualBus.setCoverUrl(current?.cover ? coverProxyUrl(current.cover) : null)
  }, [current?.cover])

  useEffect(() => {
    visualBus.setAccentColor(accentColor)
  }, [accentColor])


  useEffect(() => {
    attachVisualAudio(playerAudio)
    startVisualAudio()
    return stopVisualAudio
  }, [playerAudio])

  useEffect(() => {
    const resumeFromGesture = (): void => {
      void resumeVisualAudio()
    }
    window.addEventListener('pointerdown', resumeFromGesture, true)
    window.addEventListener('keydown', resumeFromGesture, true)
    return () => {
      window.removeEventListener('pointerdown', resumeFromGesture, true)
      window.removeEventListener('keydown', resumeFromGesture, true)
    }
  }, [])


  // 全局快捷键：togglePlay / prevTrack / nextTrack / volumeUp / volumeDown / toggleFullscreen
  useEffect(() => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    // 旧版启动即按默认表注册（index.html HOTKEY_ACTIONS 的 global 列）；
    // 不注册的话主进程 globalShortcut 列表为空，onGlobalHotkey 永远不会触发
    void desktop.configureGlobalHotkeys([
      { action: 'togglePlay', accelerator: 'Ctrl+Alt+Space' },
      { action: 'prevTrack', accelerator: 'Ctrl+Alt+Left' },
      { action: 'nextTrack', accelerator: 'Ctrl+Alt+Right' },
      { action: 'volumeUp', accelerator: 'Ctrl+Alt+Up' },
      { action: 'volumeDown', accelerator: 'Ctrl+Alt+Down' },
      { action: 'toggleFullscreen', accelerator: 'Ctrl+Alt+F' },
    ])
    return desktop.onGlobalHotkey(({ action }) => {
      const player = usePlayer.getState()
      switch (action) {
        case 'togglePlay':
          player.toggle()
          break
        case 'prevTrack':
          void player.prev()
          break
        case 'nextTrack':
          void player.next()
          break
        case 'volumeUp':
          player.setVolume(player.volume + 0.05)
          break
        case 'volumeDown':
          player.setVolume(player.volume - 0.05)
          break
        case 'toggleFullscreen':
          void desktop.toggleFullscreen()
          break
      }
    })
  }, [])

  const neteaseSearch = useQuery({
    queryKey: ['search', 'netease', debouncedKeyword],
    enabled: debouncedKeyword.length > 0,
    queryFn: () => apiJson<{ songs: UnifiedSong[] }>(searchPath('netease', debouncedKeyword, 20)),
  })
  const qqSearch = useQuery({
    queryKey: ['search', 'qq', debouncedKeyword],
    enabled: debouncedKeyword.length > 0,
    queryFn: () => apiJson<{ songs: UnifiedSong[] }>(searchPath('qq', debouncedKeyword, 12)),
  })
  const activeSearch = provider === 'qq' ? qqSearch : neteaseSearch
  const songs = useMemo(() => activeSearch.data?.songs ?? [], [activeSearch.data?.songs])

  const previousKeywordEmpty = useRef(true)
  useEffect(() => {
    const hasKeyword = Boolean(keyword.trim())
    if (hasKeyword && previousKeywordEmpty.current) setProvider(providerOrder[0])
    previousKeywordEmpty.current = !hasKeyword
  }, [keyword, providerOrder])

  useEffect(() => {
    try { localStorage.setItem(PROVIDER_ORDER_KEY, JSON.stringify(providerOrder)) } catch { /* session only */ }
  }, [providerOrder])
  useEffect(() => {
    const close = (event: PointerEvent): void => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) setSearchOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [])

  const dropProvider = (target: ProviderId): void => {
    if (!draggedProvider || draggedProvider === target) return
    setProviderOrder(() => [target, draggedProvider])
    setDraggedProvider(null)
  }

  const runBackgroundCommand = useCallback(async (command: () => Promise<import('@shared/custom-background-contract').CustomBackgroundResult> | undefined) => {
    setBackgroundBusy(true)
    setBackgroundError('')
    try {
      const result = await command()
      if (!result || result.canceled) return
      if (!result.ok) throw new Error(result.error || '背景导入失败')
      setCustomBackground(result.background)
      setBackgroundMediaFailed(false)
      setWallpaperProjects([])
    } catch (error) {
      setBackgroundError(error instanceof Error ? error.message : '背景导入失败')
    } finally {
      setBackgroundBusy(false)
    }
  }, [])

  const scanWallpaperEngine = useCallback(async () => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    setBackgroundBusy(true)
    setBackgroundError('')
    try {
      const result = await desktop.scanWallpaperEngineProjects()
      if (!result.ok) throw new Error(result.error || 'Wallpaper Engine 扫描失败')
      setWallpaperProjects(result.projects)
      if (!result.projects.length) setBackgroundError('未找到可直接导入的视频壁纸；网页与 scene 项目不受支持。')
    } catch (error) {
      setBackgroundError(error instanceof Error ? error.message : 'Wallpaper Engine 扫描失败')
    } finally {
      setBackgroundBusy(false)
    }
  }, [])

  const backgroundMode: BackgroundMode = customBackground && !backgroundMediaFailed ? 'wallpaper' : 'visual'

  return (
    <div className={`app motion-${motionStyle}`} data-background-mode={backgroundMode}>
      {backgroundMode === 'wallpaper' && customBackground ? <div className="custom-background-layer" aria-hidden="true">
        {customBackground.kind === 'video'
          ? <video key={customBackground.url} src={customBackground.url} muted loop autoPlay playsInline onError={() => { setBackgroundMediaFailed(true); setBackgroundError('背景视频加载失败，已恢复音乐视觉。') }} />
          : <img key={customBackground.url} src={customBackground.url} alt="" onError={() => { setBackgroundMediaFailed(true); setBackgroundError('背景图片加载失败，已恢复音乐视觉。') }} />}
      </div> : null}
      <StageCanvas className="stage-bg" preset={visualPreset} backgroundEnabled={backgroundMode === 'visual'} />
      <AppTopBar
        settingsOpen={settingsOpen}
        onToggleSettings={() => { setActiveSheet(null); setSettingsOpen((open) => !open) }}
      />
      <ThemePanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        visualPreset={visualPreset}
        onVisualPresetChange={setVisualPreset}
        customBackground={customBackground}
        backgroundBusy={backgroundBusy}
        backgroundError={backgroundError}
        wallpaperProjects={wallpaperProjects}
        onChooseBackground={() => void runBackgroundCommand(() => window.fluxDesktop?.chooseCustomBackgroundFile())}
        onClearBackground={() => void runBackgroundCommand(() => window.fluxDesktop?.clearCustomBackground())}
        onScanWallpaperEngine={() => void scanWallpaperEngine()}
        onChooseWallpaperEngine={() => void runBackgroundCommand(() => window.fluxDesktop?.chooseWallpaperEngineProject())}
        onImportWallpaperEngine={(projectId) => void runBackgroundCommand(() => window.fluxDesktop?.importWallpaperEngineProject(projectId))}
        motionStyle={motionStyle}
        onMotionStyleChange={(style) => { setMotionStyle(style); localStorage.setItem('flux-ui-motion', style) }}
      />
      <PlaylistDetailSheet
        open={activeSheet === 'detail'}
        available={Boolean(shelfDetail)}
        onOpenChange={(open) => setActiveSheet(open ? 'detail' : null)}
      >
      {shelfDetail &&
      shelfDetail.provider === provider &&
      shelfDetail.identityToken === (activeIdentity || 'guest') ? (
        <ShelfDetailPanel
          key={`${shelfDetail.provider}:${shelfDetail.playlist.id}`}
          detail={shelfDetail}
          onPlay={(tracks, startIndex) => { void setQueue([...tracks], startIndex) }}
        />
      ) : <div className="shelf-detail-status">请先从音乐库选择歌单</div>}
      </PlaylistDetailSheet>
      <StageLyricsSynchronizer />
      <LibrarySheet>
        <aside className="library-drawer" aria-label="用户音乐库">
          <div className="library-provider-tabs" role="tablist" aria-label="音乐平台">
            {(['netease', 'qq'] as const).map((item) => (
              <button key={item} role="tab" aria-selected={provider === item} className={provider === item ? 'active' : ''} onClick={() => { setProvider(item); closeShelfDetail() }}>
                {item === 'netease' ? '网易云' : 'QQ 音乐'}
              </button>
            ))}
          </div>
          <AccountArea provider={provider} />
          <div className="library-shortcuts" aria-label="快捷歌单">
            <button type="button" disabled={!shelfLoggedIn} onClick={openLikedTracks}><strong>我的喜欢</strong><small>{shelfLoggedIn ? '平台收藏' : '登录后查看'}</small></button>
            <button type="button" disabled={recentTracks.length === 0} onClick={openRecentTracks}><strong>最近播放</strong><small>{recentTracks.length ? `${recentTracks.length} 首` : '暂无记录'}</small></button>
          </div>
          {shelfPlaylistsQuery.isFetching ? <div className="library-shelf-sync">正在同步歌单…</div> : null}
          <div className="library-playlist-list" data-scroll-region>{shelfPlaylists.map((playlist, index) => (
            <button key={String(playlist.id)} type="button" className={String(shelfDetail?.playlist.id) === String(playlist.id) ? 'active' : ''} onClick={() => { localStorage.setItem(`flux-last-playlist:${provider}:${activeIdentity}`, String(playlist.id)); setActiveSheet('detail'); handleShelfAction(index) }}>
              <PlaylistCoverImage
                key={`${playlist.id}:${playlist.cover}:${(playlistCoverFallbacks[String(playlist.id)] ?? []).join('|')}`}
                candidates={[playlist.cover || '', ...(playlistCoverFallbacks[String(playlist.id)] ?? [])]}
              />
              <span><strong>{playlist.name}</strong><small>{playlist.trackCount} 首</small></span>
            </button>
          ))}</div>
        </aside>
      </LibrarySheet>
      <div className="search-hover-sensor" aria-hidden="true" onPointerEnter={() => { setSearchOpen(Boolean(keyword.trim())); inputRef.current?.focus() }} />
      <div className="content">
        <div className="search-shell" ref={searchRef}>
          <div ref={searchGlassRef} className={`searchbar${classicTheme ? ' classic-search-glass' : ''}`}>
            {classicTheme ? (
              <svg className="control-glass-filter-svg" aria-hidden="true" focusable="false">
                <defs dangerouslySetInnerHTML={{ __html: CLASSIC_GLASS_FILTER_SVG
                  .replaceAll(CLASSIC_GLASS_FILTER_ID, 'flux-classic-search-glass-filter')
                  .replaceAll(CLASSIC_GLASS_MAP_ID, 'flux-classic-search-glass-map') }} />
              </svg>
            ) : null}
            <Input
              ref={inputRef}
              value={keyword}
              placeholder="搜索歌曲 / 歌手"
              onFocus={() => { if (keyword.trim()) setSearchOpen(true) }}
              onChange={(event) => { setKeyword(event.target.value); setSearchOpen(Boolean(event.target.value.trim())) }}
              aria-expanded={searchOpen && Boolean(keyword.trim())}
              aria-controls="search-results-popover"
            />
          </div>
          {searchOpen && keyword.trim() ? (
            <section id="search-results-popover" className="search-popover glass-surface" aria-label="搜索结果">
              <div className="search-provider-tabs" role="tablist" aria-label="搜索渠道">
                {providerOrder.map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    draggable
                    aria-selected={provider === item}
                    className={provider === item ? 'active' : ''}
                    onDragStart={() => setDraggedProvider(item)}
                    onDragEnd={() => setDraggedProvider(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropProvider(item)}
                    onClick={() => setProvider(item)}
                  >
                    {item === 'netease' ? '网易云' : 'QQ 音乐'}
                    <small>{item === 'netease' ? neteaseSearch.data?.songs?.length ?? 0 : qqSearch.data?.songs?.length ?? 0}</small>
                  </button>
                ))}
                <span className="search-parallel-hint">双渠道并行</span>
              </div>
              <div className="results search-results" data-scroll-region>
                {songs.length === 0 ? (
                  <div className="empty">
                    {activeSearch.isFetching ? '搜索中…' : activeSearch.error instanceof Error ? `搜索失败：${activeSearch.error.message}` : debouncedKeyword ? '没有结果' : '准备搜索…'}
                  </div>
                ) : songs.map((song, index) => {
                  const key = `${song.provider}-${song.id}`
                  const active = current && `${current.provider}-${current.id}` === key
                  return (
                    <button
                      type="button"
                      key={`${key}-${index}`}
                      className={`result-row${active ? ' active' : ''}`}
                      onClick={() => {
                        setSearchOpen(false)
                        setKeyword('')
                        void setQueue([...songs], index)
                      }}
                    >
                      {song.cover ? <img src={coverProxyUrl(song.cover)} alt="" loading="lazy" /> : <span className="result-cover-placeholder" />}
                      <span className="meta"><strong className="name">{song.name}</strong><small className="artist">{song.artist}{song.album ? ` · ${song.album}` : ''}</small></span>
                      <span className="tag">{song.provider === 'qq' ? 'QQ' : '网易云'}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ) : null}
        </div>

        <PlayerBar />
        <FallbackNotice />
      </div>
    </div>
  )
}

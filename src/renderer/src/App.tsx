import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { CustomBackground, WallpaperEngineProject } from '@shared/custom-background-contract'
import type { ProviderId } from '@shared/models'
import { AppTopBar, FocusModeExitControls } from './components/shell/AppTopBar'
import { FallbackNotice, PlayerBar } from './components/player/PlayerBar'
import { LibraryWorkspace } from './features/library'
import { StageLyricsSynchronizer } from './features/lyrics'
import { SearchPanel } from './features/search'
import { useAuth } from './stores/auth'
import { gsap, motionDurations, motionEases, useGSAP, useReducedMotion } from './motion'
import { usePlaybackProgress, usePlayer } from './stores/player'
import { isDynamicBackgroundEffect, type DynamicBackgroundEffect } from './visual/backgrounds'
import { parseBackgroundMode, type BackgroundMode } from './visual/background-mode'
import type { LyricsOffset } from './visual/StageCanvas'
import { isLyricsAnimationMode, type LyricsAnimationMode } from './visual/lyrics3d-mesh/animation'

const SettingsPanel = lazy(() => import('./features/settings/SettingsPanel'))
const StageCanvas = lazy(() =>
  import('./visual/StageCanvas').then((module) => ({ default: module.StageCanvas })),
)

const DYNAMIC_BACKGROUND_KEY = 'fluxplayer-dynamic-background-v1'
const LEGACY_VISUAL_PRESET_KEY = 'fluxplayer-visual-preset-v1'
const LEGACY_UI_MOTION_KEY = 'flux-ui-motion'
const LYRICS_DRAG_KEY = 'flux-lyrics-drag-enabled'
const LYRICS_OFFSET_KEY = 'flux-lyrics-offset'
const LYRICS_ANIMATION_KEY = 'flux-lyrics-animation-mode-v1'
const BACKGROUND_MODE_KEY = 'fluxplayer-background-mode-v1'

function initialLyricsDragEnabled(): boolean {
  try {
    return localStorage.getItem(LYRICS_DRAG_KEY) === '1'
  } catch {
    return false
  }
}

function initialLyricsOffset(): LyricsOffset {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(LYRICS_OFFSET_KEY) ?? 'null',
    ) as Partial<LyricsOffset> | null
    return parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
      ? { x: Number(parsed.x), y: Number(parsed.y) }
      : { x: 0, y: 0 }
  } catch {
    return { x: 0, y: 0 }
  }
}

function initialDynamicBackground(): DynamicBackgroundEffect {
  try {
    const raw = localStorage.getItem(DYNAMIC_BACKGROUND_KEY)
    return isDynamicBackgroundEffect(raw) ? raw : 'light-rays'
  } catch {
    return 'light-rays'
  }
}

function initialLyricsAnimationMode(): LyricsAnimationMode {
  try {
    const raw = localStorage.getItem(LYRICS_ANIMATION_KEY)
    return isLyricsAnimationMode(raw) ? raw : 'compact'
  } catch {
    return 'compact'
  }
}

function initialBackgroundMode(): BackgroundMode | null {
  try {
    return parseBackgroundMode(localStorage.getItem(BACKGROUND_MODE_KEY))
  } catch {
    return null
  }
}

function useAuthLifecycle(): void {
  const refreshAll = useAuth((state) => state.refreshAll)
  const qqLoggedIn = useAuth((state) => state.qq?.loggedIn === true)
  const startQQPolling = useAuth((state) => state.startQQPolling)

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (!qqLoggedIn) return
    return startQQPolling()
  }, [qqLoggedIn, startQQPolling])

  useEffect(() => () => useAuth.getState().stopQQPolling(), [])
}

function useGlobalHotkeys(): void {
  useEffect(() => {
    const desktop = window.fluxDesktop
    if (!desktop) return
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
}

function isPlaybackShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="option"], [role="slider"], [data-scroll-region]',
    ),
  )
}

function usePlaybackKeyboardShortcuts(focusMode: boolean, exitFocusMode: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && focusMode) {
        event.preventDefault()
        exitFocusMode()
        return
      }
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        isPlaybackShortcutTarget(event.target)
      ) {
        return
      }

      const player = usePlayer.getState()
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (event.repeat || player.queue.length === 0) return
        event.preventDefault()
        if (event.key === 'ArrowUp') void player.prev()
        else void player.next()
        return
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const { position, duration } = usePlaybackProgress.getState()
      if (!player.current || duration <= 0) return
      event.preventDefault()
      const nextPosition = position + (event.key === 'ArrowLeft' ? -5 : 5)
      player.seek(Math.max(0, Math.min(duration, nextPosition)) / duration)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [exitFocusMode, focusMode])
}

export default function App(): React.JSX.Element {
  const [provider, setProvider] = useState<ProviderId>('netease')
  const [dynamicBackground, setDynamicBackground] =
    useState<DynamicBackgroundEffect>(initialDynamicBackground)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsMounted, setSettingsMounted] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [lyricsDragEnabled, setLyricsDragEnabled] = useState(initialLyricsDragEnabled)
  const [lyricsAnimationMode, setLyricsAnimationMode] =
    useState<LyricsAnimationMode>(initialLyricsAnimationMode)
  const [lyricsOffset, setLyricsOffset] = useState<LyricsOffset>(initialLyricsOffset)
  const [customBackground, setCustomBackground] = useState<CustomBackground | null>(null)
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode | null>(initialBackgroundMode)
  const [backgroundMediaFailed, setBackgroundMediaFailed] = useState(false)
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const [backgroundError, setBackgroundError] = useState('')
  const [wallpaperProjects, setWallpaperProjects] = useState<WallpaperEngineProject[]>([])
  const appRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()

  useAuthLifecycle()
  useGlobalHotkeys()

  const exitFocusMode = useCallback(() => {
    setFocusMode(false)
    const desktop = window.fluxDesktop
    if (!desktop) return
    void desktop
      .getWindowState()
      .then((state) => (state.isFullScreen ? desktop.exitFullscreenWindowed() : undefined))
  }, [])

  const enterFocusMode = useCallback(() => {
    setSettingsOpen(false)
    const desktop = window.fluxDesktop
    if (!desktop) {
      setFocusMode(true)
      return
    }
    void desktop
      .getWindowState()
      .then(async (state) => {
        if (!state.isFullScreen) await desktop.toggleFullscreen()
        setFocusMode(true)
      })
      .catch(() => setFocusMode(false))
  }, [])

  usePlaybackKeyboardShortcuts(focusMode, exitFocusMode)

  useEffect(() => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    return desktop.onWindowState((state) => {
      if (!state.isFullScreen) setFocusMode(false)
    })
  }, [])

  useEffect(() => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    const applyCustomBackground = (background: CustomBackground | null): void => {
      setCustomBackground(background)
      setBackgroundMode((mode) => (background ? (mode ?? 'wallpaper') : 'dynamic'))
    }
    void desktop.getCustomBackground().then(applyCustomBackground)
    return desktop.onCustomBackgroundChanged(applyCustomBackground)
  }, [])

  useEffect(() => setBackgroundMediaFailed(false), [customBackground?.url])

  useEffect(() => {
    try {
      localStorage.setItem(DYNAMIC_BACKGROUND_KEY, dynamicBackground)
      localStorage.removeItem(LEGACY_VISUAL_PRESET_KEY)
      localStorage.removeItem(LEGACY_UI_MOTION_KEY)
    } catch {
      // Keep the selected background for this session when persistence is unavailable.
    }
  }, [dynamicBackground])

  useEffect(() => {
    if (!backgroundMode) return
    try {
      localStorage.setItem(BACKGROUND_MODE_KEY, backgroundMode)
    } catch {
      // Keep the selected replacement source for this session when persistence is unavailable.
    }
  }, [backgroundMode])

  useEffect(() => {
    try {
      localStorage.setItem(LYRICS_ANIMATION_KEY, lyricsAnimationMode)
    } catch {
      // Keep the selected lyric motion for this session when persistence is unavailable.
    }
  }, [lyricsAnimationMode])

  useEffect(() => {
    try {
      localStorage.setItem(LYRICS_DRAG_KEY, lyricsDragEnabled ? '1' : '0')
    } catch {
      // Keep the setting for this session when persistence is unavailable.
    }
  }, [lyricsDragEnabled])

  useEffect(() => {
    try {
      localStorage.setItem(LYRICS_OFFSET_KEY, JSON.stringify(lyricsOffset))
    } catch {
      // Keep the position for this session when persistence is unavailable.
    }
  }, [lyricsOffset])

  const runBackgroundCommand = useCallback(
    async (
      command: () => Promise<import('@shared/custom-background-contract').CustomBackgroundResult> | undefined,
    ) => {
      setBackgroundBusy(true)
      setBackgroundError('')
      try {
        const result = await command()
        if (!result || result.canceled) return
        if (!result.ok) throw new Error(result.error || '背景导入失败')
        setCustomBackground(result.background)
        setBackgroundMode(result.background ? 'wallpaper' : 'dynamic')
        setBackgroundMediaFailed(false)
        setWallpaperProjects([])
      } catch (error) {
        setBackgroundError(error instanceof Error ? error.message : '背景导入失败')
      } finally {
        setBackgroundBusy(false)
      }
    },
    [],
  )

  const scanWallpaperEngine = useCallback(async () => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    setBackgroundBusy(true)
    setBackgroundError('')
    try {
      const result = await desktop.scanWallpaperEngineProjects()
      if (!result.ok) throw new Error(result.error || 'Wallpaper Engine 扫描失败')
      setWallpaperProjects(result.projects)
      if (!result.projects.length) {
        setBackgroundError('未找到可直接导入的视频壁纸；网页与 scene 项目不受支持。')
      }
    } catch (error) {
      setBackgroundError(error instanceof Error ? error.message : 'Wallpaper Engine 扫描失败')
    } finally {
      setBackgroundBusy(false)
    }
  }, [])

  const effectiveBackgroundMode: BackgroundMode =
    backgroundMode === 'wallpaper' && customBackground && !backgroundMediaFailed ? 'wallpaper' : 'dynamic'

  useGSAP(
    () => {
      const topbar = appRef.current?.querySelector<HTMLElement>('[data-app-chrome="topbar"]')
      const content = appRef.current?.querySelector<HTMLElement>('[data-app-chrome="content"]')
      const targets = [topbar, content].filter((target): target is HTMLElement => Boolean(target))
      if (reducedMotion) {
        gsap.set(targets, {
          autoAlpha: focusMode ? 0 : 1,
          y: 0,
          pointerEvents: focusMode ? 'none' : 'auto',
        })
        return
      }

      gsap.to(targets, {
        autoAlpha: focusMode ? 0 : 1,
        y: (index) => (focusMode ? (index === 0 ? -10 : 10) : 0),
        pointerEvents: focusMode ? 'none' : 'auto',
        duration: motionDurations.emphasized,
        ease: focusMode ? motionEases.exit : motionEases.enter,
        stagger: 0.02,
        overwrite: 'auto',
      })
      return () => gsap.killTweensOf(targets)
    },
    {
      scope: appRef,
      dependencies: [focusMode, reducedMotion],
      revertOnUpdate: true,
    },
  )

  return (
    <div
      ref={appRef}
      className="app group/app relative flex h-full flex-col overflow-hidden bg-[var(--flux-bg)]"
      data-app-root=""
      data-background-mode={effectiveBackgroundMode}
      data-focus-mode={focusMode || undefined}
    >
      {effectiveBackgroundMode === 'wallpaper' && customBackground ? (
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
          {customBackground.kind === 'video' ? (
            <video
              key={customBackground.url}
              src={customBackground.url}
              muted
              loop
              autoPlay
              playsInline
              className="size-full object-cover"
              onError={() => {
                setBackgroundMediaFailed(true)
                setBackgroundMode('dynamic')
                setBackgroundError('背景视频加载失败，已恢复动态背景。')
              }}
            />
          ) : (
            <img
              key={customBackground.url}
              src={customBackground.url}
              alt=""
              className="size-full object-cover"
              onError={() => {
                setBackgroundMediaFailed(true)
                setBackgroundMode('dynamic')
                setBackgroundError('背景图片加载失败，已恢复动态背景。')
              }}
            />
          )}
        </div>
      ) : null}
      <Suspense fallback={null}>
        <StageCanvas
          className="pointer-events-auto absolute inset-0 z-[1]"
          backgroundEffect={dynamicBackground}
          backgroundEnabled={effectiveBackgroundMode === 'dynamic'}
          lyricsDragEnabled={lyricsDragEnabled}
          lyricsAnimationMode={lyricsAnimationMode}
          lyricsOffset={lyricsOffset}
          onLyricsOffsetChange={setLyricsOffset}
        />
      </Suspense>
      <AppTopBar
        settingsOpen={settingsOpen}
        onToggleSettings={() => {
          setSettingsMounted(true)
          setSettingsOpen((open) => !open)
        }}
        onEnterFocusMode={enterFocusMode}
      />
      {focusMode ? <FocusModeExitControls onExit={exitFocusMode} /> : null}
      {settingsMounted ? (
        <Suspense fallback={null}>
          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            dynamicBackground={dynamicBackground}
            onDynamicBackgroundChange={(effect) => {
              setDynamicBackground(effect)
              setBackgroundMode('dynamic')
            }}
            backgroundMode={effectiveBackgroundMode}
            onBackgroundModeChange={(mode) => {
              if (mode === 'wallpaper') {
                setBackgroundMediaFailed(false)
                setBackgroundError('')
              }
              setBackgroundMode(mode)
            }}
            customBackground={customBackground}
            backgroundBusy={backgroundBusy}
            backgroundError={backgroundError}
            wallpaperProjects={wallpaperProjects}
            onChooseBackground={() =>
              void runBackgroundCommand(() => window.fluxDesktop?.chooseCustomBackgroundFile())
            }
            onClearBackground={() =>
              void runBackgroundCommand(() => window.fluxDesktop?.clearCustomBackground())
            }
            onScanWallpaperEngine={() => void scanWallpaperEngine()}
            onChooseWallpaperEngine={() =>
              void runBackgroundCommand(() => window.fluxDesktop?.chooseWallpaperEngineProject())
            }
            onImportWallpaperEngine={(projectId) =>
              void runBackgroundCommand(() => window.fluxDesktop?.importWallpaperEngineProject(projectId))
            }
            lyricsDragEnabled={lyricsDragEnabled}
            lyricsAnimationMode={lyricsAnimationMode}
            onLyricsAnimationModeChange={setLyricsAnimationMode}
            onLyricsDragEnabledChange={setLyricsDragEnabled}
            onResetLyricsPosition={() => setLyricsOffset({ x: 0, y: 0 })}
          />
        </Suspense>
      ) : null}
      <StageLyricsSynchronizer />
      <LibraryWorkspace provider={provider} onProviderChange={setProvider} />
      <div
        data-app-chrome="content"
        className="content relative z-[71] mx-auto flex min-h-0 w-full max-w-[min(1180px,calc(100vw-24px))] flex-1 flex-col gap-3.5 px-[22px] pt-1 pb-[18px]"
      >
        <SearchPanel provider={provider} onProviderChange={setProvider} />
        <PlayerBar />
        <FallbackNotice />
      </div>
    </div>
  )
}

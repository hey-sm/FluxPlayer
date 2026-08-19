import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CustomBackground } from '@shared/custom-background-contract'
import type { ProviderId } from '@shared/models'
import {
  DEFAULT_WALLPAPER_ENGINE_STATE,
  type WallpaperEngineLibrarySnapshot,
  type WallpaperEngineProject,
  type WallpaperEngineRuntimeStatus,
  type WallpaperEngineState,
} from '@shared/wallpaper-engine-contract'
import { AppTopBar, FocusModeExitControls } from './components/shell/AppTopBar'
import { PlayerBar } from './components/player/PlayerBar'
import { ToastViewport } from './components/ui/toast-viewport'
import { LibraryWorkspace } from './features/library'
import { StageLyricsSynchronizer } from './features/lyrics'
import { SearchPanel } from './features/search'
import { useAuth } from './stores/auth'
import { showToast } from './stores/toast'
import { gsap, motionDurations, motionEases, useGSAP, useReducedMotion } from './motion'
import { usePlaybackProgress, usePlayer } from './stores/player'
import { isDynamicBackgroundEffect, type DynamicBackgroundEffect } from './visual/backgrounds'
import { parseBackgroundMode, type BackgroundMode } from './visual/background-mode'
import type { LyricsOffset } from './visual/StageCanvas'
import { isLyricsAnimationMode, type LyricsAnimationMode } from './visual/lyrics3d-mesh/animation'
import { WallpaperEngineLayer } from './features/settings/WallpaperEngineLayer'

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
const LYRICS_FOCUS_ONLY_KEY = 'flux-lyrics-focus-only-v1'
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

function initialLyricsFocusOnly(): boolean {
  try {
    return localStorage.getItem(LYRICS_FOCUS_ONLY_KEY) === '1'
  } catch {
    return false
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
  const validateOnStartup = useAuth((state) => state.validateOnStartup)
  const qqLoggedIn = useAuth((state) => state.qq?.loggedIn === true)
  const startQQPolling = useAuth((state) => state.startQQPolling)

  useEffect(() => {
    void validateOnStartup()
  }, [validateOnStartup])

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
  const [lyricsFocusOnly, setLyricsFocusOnly] = useState(initialLyricsFocusOnly)
  const [lyricsOffset, setLyricsOffset] = useState<LyricsOffset>(initialLyricsOffset)
  const [customBackground, setCustomBackground] = useState<CustomBackground | null>(null)
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode | null>(initialBackgroundMode)
  const [backgroundMediaFailed, setBackgroundMediaFailed] = useState(false)
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const [wallpaperEngineState, setWallpaperEngineState] = useState<WallpaperEngineState>(() => ({
    version: DEFAULT_WALLPAPER_ENGINE_STATE.version,
    selection: { ...DEFAULT_WALLPAPER_ENGINE_STATE.selection },
    favorites: [],
    hidden: [],
  }))
  const [wallpaperEngineSnapshot, setWallpaperEngineSnapshot] =
    useState<WallpaperEngineLibrarySnapshot | null>(null)
  const [wallpaperEngineRuntimeStatus, setWallpaperEngineRuntimeStatus] =
    useState<WallpaperEngineRuntimeStatus>({
      ok: true,
      active: false,
      mode: 'none',
      phase: 'idle',
      sessionId: '',
      projectId: '',
      glassSamplerAvailable: false,
      error: '',
    })
  const [wallpaperEngineReady, setWallpaperEngineReady] = useState(false)
  const [wallpaperSuspended, setWallpaperSuspended] = useState(false)
  const customBackgroundVideoRef = useRef<HTMLVideoElement>(null)
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
      setWallpaperSuspended(state.isMinimized || !state.isVisible)
    })
  }, [])

  useEffect(() => {
    const desktop = window.fluxDesktop
    if (!desktop || !wallpaperEngineState.selection.active) {
      setWallpaperEngineRuntimeStatus((current) =>
        current.active || current.mode !== 'none'
          ? {
              ok: true,
              active: false,
              mode: 'none',
              phase: 'idle',
              sessionId: '',
              projectId: '',
              glassSamplerAvailable: false,
              error: '',
            }
          : current,
      )
      return
    }
    let cancelled = false
    void desktop
      .getWallpaperEngineRuntimeStatus()
      .then((status) => {
        if (!cancelled) setWallpaperEngineRuntimeStatus(status)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [wallpaperEngineState.selection])

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

  useEffect(() => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    let cancelled = false
    const applyState = (next: WallpaperEngineState): void => {
      if (!cancelled) setWallpaperEngineState(next)
    }
    void desktop
      .getWallpaperEngineState()
      .then(async (next) => {
        applyState(next)
        if (next.selection.active) {
          const result = await desktop.listWallpaperEngineProjects(false)
          if (!cancelled) {
            setWallpaperEngineSnapshot(result)
            applyState(result.state)
          }
        }
      })
      .catch(() => {
        // A browser preview or an early startup race simply keeps the default state.
      })
    const unsubscribe = desktop.onWallpaperEngineStateChanged(applyState)
    const unsubscribeRuntime = desktop.onWallpaperEngineRuntimeChanged((status) => {
      if (!cancelled) setWallpaperEngineRuntimeStatus(status)
    })
    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeRuntime()
    }
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
      localStorage.setItem(LYRICS_FOCUS_ONLY_KEY, lyricsFocusOnly ? '1' : '0')
    } catch {
      // Keep the setting for this session when persistence is unavailable.
    }
  }, [lyricsFocusOnly])

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
      try {
        const result = await command()
        if (!result || result.canceled) return
        if (!result.ok) throw new Error(result.error || '背景导入失败')
        setCustomBackground(result.background)
        setBackgroundMode(result.background ? 'wallpaper' : 'dynamic')
        setBackgroundMediaFailed(false)
      } catch (error) {
        showToast(error instanceof Error ? error.message : '背景导入失败', {
          title: '背景设置失败',
          tone: 'error',
          duration: 8000,
        })
      } finally {
        setBackgroundBusy(false)
      }
    },
    [],
  )

  const effectiveBackgroundMode: BackgroundMode =
    backgroundMode === 'wallpaper' && customBackground && !backgroundMediaFailed ? 'wallpaper' : 'dynamic'

  const selectedWallpaperEngineProject = useMemo<WallpaperEngineProject | null>(() => {
    const id = wallpaperEngineState.selection.id
    return id ? (wallpaperEngineSnapshot?.projects.find((project) => project.id === id) ?? null) : null
  }, [wallpaperEngineSnapshot, wallpaperEngineState.selection.id])

  const dwmActive =
    wallpaperEngineRuntimeStatus.active &&
    wallpaperEngineRuntimeStatus.mode === 'dwm' &&
    wallpaperEngineRuntimeStatus.phase === 'active'

  useEffect(() => {
    document.documentElement.toggleAttribute('data-wallpaper-dwm-active', dwmActive)
    return () => document.documentElement.removeAttribute('data-wallpaper-dwm-active')
  }, [dwmActive])

  const handleWallpaperEngineStateChange = useCallback((next: WallpaperEngineState): void => {
    setWallpaperEngineState(next)
  }, [])

  const handleWallpaperEngineSnapshotChange = useCallback((next: WallpaperEngineLibrarySnapshot): void => {
    setWallpaperEngineSnapshot(next)
  }, [])

  const handleWallpaperEngineDeactivate = useCallback((): void => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    setWallpaperEngineReady(false)
    setWallpaperEngineRuntimeStatus({
      ok: true,
      active: false,
      mode: 'none',
      phase: 'idle',
      sessionId: '',
      projectId: '',
      glassSamplerAvailable: false,
      error: '',
    })
    void desktop
      .setWallpaperEngineState({ action: 'clear' })
      .then(setWallpaperEngineState)
      .catch(() => undefined)
  }, [])

  const handleWallpaperEngineFailure = useCallback((id: string, error: string): void => {
    const desktop = window.fluxDesktop
    setWallpaperEngineReady(false)
    setWallpaperEngineRuntimeStatus({
      ok: false,
      active: false,
      mode: 'none',
      phase: 'failed',
      sessionId: '',
      projectId: id,
      glassSamplerAvailable: false,
      error,
    })
    showToast(`Wallpaper Engine 项目不可用，已恢复原背景（${error}）`, {
      title: '背景运行失败',
      tone: 'error',
      duration: 8000,
    })
    if (!desktop) return
    void desktop
      .setWallpaperEngineState({ action: 'runtime-error', id, error })
      .then(setWallpaperEngineState)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const video = customBackgroundVideoRef.current
    if (!video) return
    if (wallpaperEngineReady || wallpaperSuspended) {
      video.pause()
      return
    }
    void video.play().catch(() => undefined)
  }, [customBackground?.url, wallpaperEngineReady, wallpaperSuspended])

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
      style={{
        backgroundColor: dwmActive ? 'transparent' : undefined,
      }}
      data-app-root=""
      data-background-mode={effectiveBackgroundMode}
      data-wallpaper-dwm-active={dwmActive ? '' : undefined}
      data-focus-mode={focusMode || undefined}
    >
      {effectiveBackgroundMode === 'wallpaper' && customBackground && !wallpaperEngineReady ? (
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
          {customBackground.kind === 'video' ? (
            <video
              ref={customBackgroundVideoRef}
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
                showToast('背景视频加载失败，已恢复动态背景。', {
                  title: '背景加载失败',
                  tone: 'error',
                })
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
                showToast('背景图片加载失败，已恢复动态背景。', {
                  title: '背景加载失败',
                  tone: 'error',
                })
              }}
            />
          )}
        </div>
      ) : null}
      <WallpaperEngineLayer
        project={selectedWallpaperEngineProject}
        selection={wallpaperEngineState.selection}
        runtimeStatus={wallpaperEngineRuntimeStatus}
        suspended={wallpaperSuspended}
        onReadyChange={setWallpaperEngineReady}
        onFailure={handleWallpaperEngineFailure}
      />
      <Suspense fallback={null}>
        <StageCanvas
          className="pointer-events-auto absolute inset-0 z-[1]"
          backgroundEffect={dynamicBackground}
          backgroundEnabled={effectiveBackgroundMode === 'dynamic' && !wallpaperEngineReady}
          lyricsDragEnabled={lyricsDragEnabled}
          lyricsAnimationMode={lyricsAnimationMode}
          lyricsFocusOnly={lyricsFocusOnly}
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
              }
              setBackgroundMode(mode)
            }}
            customBackground={customBackground}
            backgroundBusy={backgroundBusy}
            wallpaperEngineSelection={wallpaperEngineState.selection}
            onWallpaperEngineStateChange={handleWallpaperEngineStateChange}
            onWallpaperEngineSnapshotChange={handleWallpaperEngineSnapshotChange}
            onWallpaperEngineDeactivate={handleWallpaperEngineDeactivate}
            onChooseBackground={() =>
              void runBackgroundCommand(() => window.fluxDesktop?.chooseCustomBackgroundFile())
            }
            onClearBackground={() =>
              void runBackgroundCommand(() => window.fluxDesktop?.clearCustomBackground())
            }
            lyricsDragEnabled={lyricsDragEnabled}
            lyricsAnimationMode={lyricsAnimationMode}
            onLyricsAnimationModeChange={setLyricsAnimationMode}
            lyricsFocusOnly={lyricsFocusOnly}
            onLyricsFocusOnlyChange={setLyricsFocusOnly}
            onLyricsDragEnabledChange={setLyricsDragEnabled}
            onResetLyricsPosition={() => setLyricsOffset({ x: 0, y: 0 })}
          />
        </Suspense>
      ) : null}
      <StageLyricsSynchronizer />
      <ToastViewport />
      <LibraryWorkspace provider={provider} onProviderChange={setProvider} />
      <div
        data-app-chrome="content"
        className="content relative z-[71] mx-auto flex min-h-0 w-full max-w-[min(1180px,calc(100vw-24px))] flex-1 flex-col gap-3.5 px-[22px] pt-1 pb-[18px]"
      >
        <SearchPanel provider={provider} onProviderChange={setProvider} />
        <PlayerBar />
      </div>
    </div>
  )
}

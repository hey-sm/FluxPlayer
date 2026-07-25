import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { CustomBackground, WallpaperEngineProject } from '@shared/custom-background-contract'
import type { ProviderId } from '@shared/models'
import { AppTopBar } from './components/shell/AppTopBar'
import { FallbackNotice, PlayerBar } from './components/player/PlayerBar'
import { LibraryWorkspace } from './features/library'
import { StageLyricsSynchronizer } from './features/lyrics'
import { SearchPanel } from './features/search'
import { useAuth } from './stores/auth'
import { usePlayer } from './stores/player'
import { isDynamicBackgroundEffect, type DynamicBackgroundEffect } from './visual/backgrounds'
import type { LyricsOffset } from './visual/StageCanvas'

const SettingsPanel = lazy(() => import('./features/settings/SettingsPanel'))
const StageCanvas = lazy(() =>
  import('./visual/StageCanvas').then((module) => ({ default: module.StageCanvas })),
)

const DYNAMIC_BACKGROUND_KEY = 'fluxplayer-dynamic-background-v1'
const LEGACY_VISUAL_PRESET_KEY = 'fluxplayer-visual-preset-v1'
const LEGACY_UI_MOTION_KEY = 'flux-ui-motion'
const LYRICS_DRAG_KEY = 'flux-lyrics-drag-enabled'
const LYRICS_OFFSET_KEY = 'flux-lyrics-offset'
type BackgroundMode = 'dynamic' | 'wallpaper'

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

export default function App(): React.JSX.Element {
  const [provider, setProvider] = useState<ProviderId>('netease')
  const [dynamicBackground, setDynamicBackground] =
    useState<DynamicBackgroundEffect>(initialDynamicBackground)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [lyricsDragEnabled, setLyricsDragEnabled] = useState(initialLyricsDragEnabled)
  const [lyricsOffset, setLyricsOffset] = useState<LyricsOffset>(initialLyricsOffset)
  const [customBackground, setCustomBackground] = useState<CustomBackground | null>(null)
  const [backgroundMediaFailed, setBackgroundMediaFailed] = useState(false)
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const [backgroundError, setBackgroundError] = useState('')
  const [wallpaperProjects, setWallpaperProjects] = useState<WallpaperEngineProject[]>([])

  useAuthLifecycle()
  useGlobalHotkeys()

  useEffect(() => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    void desktop.getCustomBackground().then(setCustomBackground)
    return desktop.onCustomBackgroundChanged(setCustomBackground)
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

  const backgroundMode: BackgroundMode = customBackground && !backgroundMediaFailed ? 'wallpaper' : 'dynamic'

  return (
    <div className="app" data-background-mode={backgroundMode}>
      {backgroundMode === 'wallpaper' && customBackground ? (
        <div className="custom-background-layer" aria-hidden="true">
          {customBackground.kind === 'video' ? (
            <video
              key={customBackground.url}
              src={customBackground.url}
              muted
              loop
              autoPlay
              playsInline
              onError={() => {
                setBackgroundMediaFailed(true)
                setBackgroundError('背景视频加载失败，已恢复动态背景。')
              }}
            />
          ) : (
            <img
              key={customBackground.url}
              src={customBackground.url}
              alt=""
              onError={() => {
                setBackgroundMediaFailed(true)
                setBackgroundError('背景图片加载失败，已恢复动态背景。')
              }}
            />
          )}
        </div>
      ) : null}
      <Suspense fallback={null}>
        <StageCanvas
          className="stage-bg"
          backgroundEffect={dynamicBackground}
          backgroundEnabled={backgroundMode === 'dynamic'}
          lyricsDragEnabled={lyricsDragEnabled}
          lyricsOffset={lyricsOffset}
          onLyricsOffsetChange={setLyricsOffset}
        />
      </Suspense>
      <AppTopBar settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen((open) => !open)} />
      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsPanel
            open
            onClose={() => setSettingsOpen(false)}
            dynamicBackground={dynamicBackground}
            onDynamicBackgroundChange={setDynamicBackground}
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
            onLyricsDragEnabledChange={setLyricsDragEnabled}
            onResetLyricsPosition={() => setLyricsOffset({ x: 0, y: 0 })}
          />
        </Suspense>
      ) : null}
      <StageLyricsSynchronizer />
      <LibraryWorkspace provider={provider} onProviderChange={setProvider} />
      <div className="content">
        <SearchPanel provider={provider} onProviderChange={setProvider} />
        <PlayerBar />
        <FallbackNotice />
      </div>
    </div>
  )
}

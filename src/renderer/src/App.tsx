import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { CustomBackground, WallpaperEngineProject } from '@shared/custom-background-contract'
import type { ProviderId } from '@shared/models'
import { coverProxyUrl } from './api'
import { AppTopBar } from './components/shell/AppTopBar'
import { FallbackNotice, PlayerBar } from './components/player/PlayerBar'
import { LibraryWorkspace } from './features/library'
import { StageLyricsSynchronizer } from './features/lyrics'
import { SearchPanel } from './features/search'
import { useAuth } from './stores/auth'
import { usePlayer } from './stores/player'
import { useThemeStore } from './theme'
import { visualBus, type VisualPreset } from './visual/bus'
import { VISUAL_PRESET_BY_ID } from './visual/presets/registry'
import {
  attach as attachVisualAudio,
  resume as resumeVisualAudio,
  start as startVisualAudio,
  stop as stopVisualAudio,
} from './visual/audio'

const SettingsPanel = lazy(() => import('./features/settings/SettingsPanel'))
const StageCanvas = lazy(() =>
  import('./visual/StageCanvas').then((module) => ({ default: module.StageCanvas })),
)

const VISUAL_PRESET_KEY = 'fluxplayer-visual-preset-v1'
type BackgroundMode = 'visual' | 'wallpaper'

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

function useVisualAudio(): void {
  const currentCover = usePlayer((state) => state.current?.cover)
  const playerStatus = usePlayer((state) => state.status)
  const playerAudio = usePlayer((state) => state.audio)
  const accentColor = useThemeStore((state) => state.visualParams.accent)

  useEffect(() => {
    visualBus.setPlaybackState(playerStatus)
    if (playerStatus === 'playing') void resumeVisualAudio()
  }, [playerStatus])

  useEffect(() => {
    visualBus.setCoverUrl(currentCover ? coverProxyUrl(currentCover) : null)
  }, [currentCover])

  useEffect(() => visualBus.setAccentColor(accentColor), [accentColor])

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
  const [visualPreset, setVisualPreset] = useState<VisualPreset>(initialVisualPreset)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [motionStyle, setMotionStyle] = useState(() => localStorage.getItem('flux-ui-motion') || 'glide')
  const [customBackground, setCustomBackground] = useState<CustomBackground | null>(null)
  const [backgroundMediaFailed, setBackgroundMediaFailed] = useState(false)
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const [backgroundError, setBackgroundError] = useState('')
  const [wallpaperProjects, setWallpaperProjects] = useState<WallpaperEngineProject[]>([])

  useAuthLifecycle()
  useVisualAudio()
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
      localStorage.setItem(VISUAL_PRESET_KEY, String(visualPreset))
    } catch {
      // Keep the selected preset for this session when persistence is unavailable.
    }
  }, [visualPreset])

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

  const backgroundMode: BackgroundMode = customBackground && !backgroundMediaFailed ? 'wallpaper' : 'visual'

  return (
    <div className={`app motion-${motionStyle}`} data-background-mode={backgroundMode}>
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
                setBackgroundError('背景视频加载失败，已恢复音乐视觉。')
              }}
            />
          ) : (
            <img
              key={customBackground.url}
              src={customBackground.url}
              alt=""
              onError={() => {
                setBackgroundMediaFailed(true)
                setBackgroundError('背景图片加载失败，已恢复音乐视觉。')
              }}
            />
          )}
        </div>
      ) : null}
      <Suspense fallback={null}>
        <StageCanvas
          className="stage-bg"
          preset={visualPreset}
          backgroundEnabled={backgroundMode === 'visual'}
        />
      </Suspense>
      <AppTopBar settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen((open) => !open)} />
      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsPanel
            open
            onClose={() => setSettingsOpen(false)}
            visualPreset={visualPreset}
            onVisualPresetChange={setVisualPreset}
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
            motionStyle={motionStyle}
            onMotionStyleChange={(style) => {
              setMotionStyle(style)
              localStorage.setItem('flux-ui-motion', style)
            }}
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

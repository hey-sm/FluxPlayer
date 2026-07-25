import { lazy, Suspense, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { CustomBackground, WallpaperEngineProject } from '@shared/custom-background-contract'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Card } from '../../components/ui/card'
import { ColorPicker } from '../../components/ui/color-picker'
import { GlassSelect } from '../../components/ui/glass-select'
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { SettingsDialog } from '../../components/shell/SettingsDialog'
import { useThemeStore } from '../../theme'
import { DYNAMIC_BACKGROUND_OPTIONS, type DynamicBackgroundEffect } from '../../visual/backgrounds'

const SystemMaintenancePanel = lazy(() =>
  import('../system/SystemMaintenancePanel').then((module) => ({
    default: module.SystemMaintenancePanel,
  })),
)

export interface SettingsPanelProps {
  open: boolean
  onClose(): void
  dynamicBackground: DynamicBackgroundEffect
  onDynamicBackgroundChange(effect: DynamicBackgroundEffect): void
  customBackground: CustomBackground | null
  backgroundBusy: boolean
  backgroundError: string
  wallpaperProjects: WallpaperEngineProject[]
  onChooseBackground(): void
  onClearBackground(): void
  onScanWallpaperEngine(): void
  onChooseWallpaperEngine(): void
  onImportWallpaperEngine(projectId: string): void
  lyricsDragEnabled: boolean
  onLyricsDragEnabledChange(enabled: boolean): void
  onResetLyricsPosition(): void
}

export default function SettingsPanel({
  open,
  onClose,
  dynamicBackground,
  onDynamicBackgroundChange,
  customBackground,
  backgroundBusy,
  backgroundError,
  wallpaperProjects,
  onChooseBackground,
  onClearBackground,
  onScanWallpaperEngine,
  onChooseWallpaperEngine,
  onImportWallpaperEngine,
  lyricsDragEnabled,
  onLyricsDragEnabledChange,
  onResetLyricsPosition,
}: SettingsPanelProps): React.JSX.Element | null {
  const [activeTab, setActiveTab] = useState<'appearance' | 'system'>('appearance')
  const accent = useThemeStore((state) => state.visualParams.accent)
  const lyricsColor = useThemeStore((state) => state.lyricsColor)
  const lyricsColorLinked = useThemeStore((state) => state.lyricsColorLinked)
  const setAccent = useThemeStore((state) => state.setAccent)
  const setLyricsColor = useThemeStore((state) => state.setLyricsColor)
  const setLyricsColorLinked = useThemeStore((state) => state.setLyricsColorLinked)
  if (!open) return null

  const activeDynamicBackground = DYNAMIC_BACKGROUND_OPTIONS.find(
    (option) => option.value === dynamicBackground,
  )
  return (
    <SettingsDialog
      open={open}
      wide={activeTab === 'system'}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
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

          {activeTab === 'appearance' ? (
            <>
              <section className="appearance-color-settings" aria-label="主题颜色">
                <ColorPicker
                  value={accent}
                  label="主题与灯光色"
                  description="用于界面强调、播放进度和动态背景灯光；本地壁纸保持原色。"
                  onChange={setAccent}
                />
                <div className="lyrics-color-link">
                  <span>
                    <strong>歌词高亮色</strong>
                    <small>默认跟随主题；分开后可针对背景提升可读性。</small>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={lyricsColorLinked}
                    aria-label="歌词高亮色跟随主题"
                    className="settings-switch"
                    data-state={lyricsColorLinked ? 'checked' : 'unchecked'}
                    onClick={() => setLyricsColorLinked(!lyricsColorLinked)}
                  >
                    <span className="settings-switch-thumb" />
                  </button>
                  <em>{lyricsColorLinked ? '跟随' : '独立'}</em>
                </div>
                {!lyricsColorLinked ? (
                  <ColorPicker
                    className="lyrics-color-picker"
                    value={lyricsColor}
                    label="歌词颜色"
                    swatches={[]}
                    onChange={setLyricsColor}
                  />
                ) : null}
              </section>

              <div className="theme-field">
                <span>动态背景</span>
                <GlassSelect
                  value={dynamicBackground}
                  ariaLabel="动态背景"
                  className="theme-select-trigger"
                  contentClassName="theme-select-menu"
                  options={DYNAMIC_BACKGROUND_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  onValueChange={(value) => onDynamicBackgroundChange(value as DynamicBackgroundEffect)}
                />
                <small>{activeDynamicBackground?.description}</small>
              </div>

              <div className="theme-field lyrics-position-field">
                <span>歌词位置</span>
                <div className="lyrics-position-controls">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={lyricsDragEnabled}
                    aria-label="允许拖拽歌词"
                    className="settings-switch"
                    data-state={lyricsDragEnabled ? 'checked' : 'unchecked'}
                    onClick={() => onLyricsDragEnabledChange(!lyricsDragEnabled)}
                  >
                    <span className="settings-switch-thumb" />
                  </button>
                  <span className="lyrics-position-status">{lyricsDragEnabled ? '移动位置' : '3D 旋转'}</span>
                  <button
                    type="button"
                    className="lyrics-reset-button"
                    aria-label="重置歌词位置"
                    title="重置歌词位置"
                    onClick={onResetLyricsPosition}
                  >
                    <RotateCcw size={14} strokeWidth={1.8} />
                  </button>
                </div>
              </div>

              <section className="custom-background-settings" aria-label="自定义背景">
                <div className="custom-background-heading">
                  <span>
                    <strong>自定义背景</strong>
                    <small>图片或静音循环视频；启用后替换动态背景并保留 3D 歌词</small>
                  </span>
                  {customBackground ? (
                    <em>
                      {customBackground.source === 'wallpaper-engine' ? 'Wallpaper Engine' : '本地文件'}
                    </em>
                  ) : null}
                </div>
                <div className="custom-background-current">
                  {customBackground ? customBackground.name : '当前使用动态背景'}
                </div>
                <div className="custom-background-actions">
                  <button type="button" disabled={backgroundBusy} onClick={onChooseBackground}>
                    选择图片 / 视频
                  </button>
                  <button type="button" disabled={backgroundBusy} onClick={onScanWallpaperEngine}>
                    扫描 Wallpaper Engine
                  </button>
                  <button type="button" disabled={backgroundBusy} onClick={onChooseWallpaperEngine}>
                    手选 WE 项目
                  </button>
                  {customBackground ? (
                    <button type="button" disabled={backgroundBusy} onClick={onClearBackground}>
                      清除
                    </button>
                  ) : null}
                </div>
                {wallpaperProjects.length ? (
                  <div className="wallpaper-project-list" data-scroll-region>
                    {wallpaperProjects.map((project) => (
                      <button
                        type="button"
                        key={project.id}
                        disabled={backgroundBusy}
                        onClick={() => onImportWallpaperEngine(project.id)}
                      >
                        <span className="wallpaper-project-preview">
                          {project.previewUrl ? <img src={project.previewUrl} alt="" loading="lazy" /> : null}
                        </span>
                        <span className="wallpaper-project-title">
                          {project.title}
                          <small>视频</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {backgroundError ? (
                  <Alert variant="destructive" className="custom-background-error">
                    <AlertDescription>{backgroundError}</AlertDescription>
                  </Alert>
                ) : null}
              </section>
            </>
          ) : (
            <Suspense fallback={<div className="settings-loading">正在加载维护工具…</div>}>
              <SystemMaintenancePanel />
            </Suspense>
          )}
        </Tabs>
      </Card>
    </SettingsDialog>
  )
}

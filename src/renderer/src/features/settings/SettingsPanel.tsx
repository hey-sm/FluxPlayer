import { lazy, Suspense, useState } from 'react'
import type { CustomBackground, WallpaperEngineProject } from '@shared/custom-background-contract'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Card } from '../../components/ui/card'
import { GlassSelect } from '../../components/ui/glass-select'
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { SettingsDialog } from '../../components/shell/SettingsDialog'
import type { VisualPreset } from '../../visual/bus'
import { VISUAL_PRESETS, VISUAL_PRESET_BY_ID } from '../../visual/presets/registry'

const SystemMaintenancePanel = lazy(() =>
  import('../system/SystemMaintenancePanel').then((module) => ({
    default: module.SystemMaintenancePanel,
  })),
)

export interface SettingsPanelProps {
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
}

export default function SettingsPanel({
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
}: SettingsPanelProps): React.JSX.Element | null {
  const [activeTab, setActiveTab] = useState<'appearance' | 'system'>('appearance')
  if (!open) return null

  const activeVisualPreset = VISUAL_PRESET_BY_ID.get(visualPreset)
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
                  options={VISUAL_PRESETS.map((preset) => ({
                    value: String(preset.id),
                    label: preset.label,
                  }))}
                  onValueChange={(value) => onVisualPresetChange(Number(value) as VisualPreset)}
                />
                <small>{activeVisualPreset?.description}</small>
              </div>

              <section className="custom-background-settings" aria-label="自定义背景">
                <div className="custom-background-heading">
                  <span>
                    <strong>自定义背景</strong>
                    <small>图片或静音循环视频；启用后替换音乐视觉并保留 3D 歌词</small>
                  </span>
                  {customBackground ? (
                    <em>
                      {customBackground.source === 'wallpaper-engine' ? 'Wallpaper Engine' : '本地文件'}
                    </em>
                  ) : null}
                </div>
                <div className="custom-background-current">
                  {customBackground ? customBackground.name : '当前使用主题视觉背景'}
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

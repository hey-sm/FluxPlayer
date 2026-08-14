import { lazy, Suspense, useState } from 'react'
import { cva } from 'class-variance-authority'
import { RotateCcw } from 'lucide-react'
import type { CustomBackground, WallpaperEngineProject } from '@shared/custom-background-contract'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ColorPicker } from '../../components/ui/color-picker'
import { GlassSelect } from '../../components/ui/glass-select'
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { SettingsDialog } from '../../components/shell/SettingsDialog'
import { useThemeStore } from '../../theme'
import { DYNAMIC_BACKGROUND_OPTIONS, type DynamicBackgroundEffect } from '../../visual/backgrounds'
import type { BackgroundMode } from '../../visual/background-mode'
import { LYRICS_ANIMATION_OPTIONS, type LyricsAnimationMode } from '../../visual/lyrics3d-mesh/animation'

const SystemMaintenancePanel = lazy(() =>
  import('../system/SystemMaintenancePanel').then((module) => ({
    default: module.SystemMaintenancePanel,
  })),
)

const dynamicBackgroundSelectOptions = DYNAMIC_BACKGROUND_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))

const lyricsAnimationSelectOptions = LYRICS_ANIMATION_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))

const settingsSwitchVariants = cva(
  [
    'group relative h-5 w-[34px] shrink-0 cursor-pointer rounded-full border p-0.5 outline-none',
    'transition-[background-color,border-color] duration-[var(--motion-duration-fast)] motion-reduce:transition-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2',
    'focus-visible:outline-[color-mix(in_srgb,var(--flux-accent)_58%,transparent)]',
  ],
  {
    variants: {
      checked: {
        false:
          'border-[var(--flux-glass-border)] bg-[color-mix(in_srgb,var(--flux-panel-surface)_78%,transparent)]',
        true: [
          'border-[color-mix(in_srgb,var(--flux-accent)_58%,var(--flux-glass-border))]',
          'bg-[color-mix(in_srgb,var(--flux-accent)_38%,var(--flux-panel-surface))]',
        ],
      },
    },
    defaultVariants: { checked: false },
  },
)

function SettingsSwitch({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean
  label: string
  onCheckedChange(checked: boolean): void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={settingsSwitchVariants({ checked })}
      data-state={checked ? 'checked' : 'unchecked'}
      data-settings-switch=""
      onClick={() => onCheckedChange(!checked)}
    >
      <span
        className={cn(
          'block size-3.5 rounded-full bg-[var(--flux-text-muted)]',
          'transition-[transform,background-color] duration-[var(--motion-duration-fast)] motion-reduce:transition-none',
          'group-data-[state=checked]:translate-x-3.5 group-data-[state=checked]:bg-[var(--flux-text)]',
        )}
        data-settings-switch-thumb=""
      />
    </button>
  )
}

export interface SettingsPanelProps {
  open: boolean
  onClose(): void
  dynamicBackground: DynamicBackgroundEffect
  onDynamicBackgroundChange(effect: DynamicBackgroundEffect): void
  backgroundMode: BackgroundMode
  onBackgroundModeChange(mode: BackgroundMode): void
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
  lyricsAnimationMode: LyricsAnimationMode
  onLyricsAnimationModeChange(mode: LyricsAnimationMode): void
  lyricsFocusOnly: boolean
  onLyricsFocusOnlyChange(focusOnly: boolean): void
  onLyricsDragEnabledChange(enabled: boolean): void
  onResetLyricsPosition(): void
}

export default function SettingsPanel({
  open,
  onClose,
  dynamicBackground,
  onDynamicBackgroundChange,
  backgroundMode,
  onBackgroundModeChange,
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
  lyricsAnimationMode,
  onLyricsAnimationModeChange,
  lyricsFocusOnly,
  onLyricsFocusOnlyChange,
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
  const activeDynamicBackground = DYNAMIC_BACKGROUND_OPTIONS.find(
    (option) => option.value === dynamicBackground,
  )
  const activeLyricsAnimation = LYRICS_ANIMATION_OPTIONS.find(
    (option) => option.value === lyricsAnimationMode,
  )
  return (
    <SettingsDialog
      open={open}
      wide={activeTab === 'system'}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <Card
        className="max-h-[calc(100vh-72px)] w-full overflow-y-auto border-0 bg-transparent p-[18px] text-[var(--flux-text)] shadow-none"
        data-settings-panel=""
      >
        <header className="mb-4 flex items-center justify-between gap-3">
          <div>
            <strong className="text-[15px] tracking-[0.04em]">主题设置</strong>
            <p className="mt-1 text-[11px] leading-[1.45] text-[var(--flux-text-muted)]">
              主题变量会实时应用并自动保存。
            </p>
          </div>
        </header>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
          <TabsList
            className="mb-4 -mt-1.5 flex h-auto gap-1 rounded-[10px] border-[color-mix(in_srgb,var(--flux-panel-border)_8%,transparent)] bg-[color-mix(in_srgb,var(--flux-panel-border)_3%,transparent)] p-[3px]"
            aria-label="设置分类"
            data-settings-tabs=""
          >
            <TabsTrigger
              value="appearance"
              className="min-h-[30px] rounded-[7px] text-[11px] data-[state=active]:bg-[color-mix(in_srgb,var(--flux-accent)_13%,var(--flux-panel-surface))] data-[state=active]:text-[var(--flux-text)]"
            >
              外观
            </TabsTrigger>
            <TabsTrigger
              value="system"
              className="min-h-[30px] rounded-[7px] text-[11px] data-[state=active]:bg-[color-mix(in_srgb,var(--flux-accent)_13%,var(--flux-panel-surface))] data-[state=active]:text-[var(--flux-text)]"
            >
              系统
            </TabsTrigger>
          </TabsList>

          {activeTab === 'appearance' ? (
            <div data-settings-appearance="">
              <section
                className="mb-4 grid gap-3.5 rounded-xl border border-[color-mix(in_srgb,var(--flux-panel-border)_8%,transparent)] bg-[color-mix(in_srgb,var(--flux-panel-border)_3%,transparent)] p-[13px]"
                aria-label="主题颜色"
              >
                <ColorPicker
                  value={accent}
                  label="主题与灯光色"
                  description="用于界面强调、播放进度和动态背景灯光；本地壁纸保持原色。"
                  onChange={setAccent}
                />
                <div className="flex min-h-[30px] items-center gap-2">
                  <span className="grid flex-1 gap-0.5 text-[11px] text-[var(--flux-text)]">
                    <strong>歌词高亮色</strong>
                    <small className="text-[10px] leading-[1.45] font-normal text-[var(--flux-text-muted)]">
                      默认跟随主题；分开后可针对背景提升可读性。
                    </small>
                  </span>
                  <SettingsSwitch
                    checked={lyricsColorLinked}
                    label="歌词高亮色跟随主题"
                    onCheckedChange={setLyricsColorLinked}
                  />
                  <em className="w-7 text-[10px] not-italic text-[var(--flux-text-muted)]">
                    {lyricsColorLinked ? '跟随' : '独立'}
                  </em>
                </div>
                {!lyricsColorLinked ? (
                  <ColorPicker
                    className="pt-0.5"
                    value={lyricsColor}
                    label="歌词颜色"
                    swatches={[]}
                    onChange={setLyricsColor}
                  />
                ) : null}
              </section>

              <div className="mb-[13px] grid gap-[7px] text-[11px] text-[var(--flux-text-muted)]">
                <span>动态背景（选择后替换自定义背景）</span>
                <GlassSelect
                  value={dynamicBackground}
                  ariaLabel="动态背景"
                  contentClassName="w-[var(--radix-select-trigger-width)]"
                  options={dynamicBackgroundSelectOptions}
                  onValueChange={(value) => onDynamicBackgroundChange(value as DynamicBackgroundEffect)}
                />
                <small className="text-[10px] leading-[1.45] text-[var(--flux-text-muted)]">
                  {activeDynamicBackground?.description}
                </small>
              </div>

              <div className="mb-[13px] grid gap-[7px] text-[11px] text-[var(--flux-text-muted)]">
                <span>歌词动画</span>
                <GlassSelect
                  value={lyricsAnimationMode}
                  ariaLabel="歌词动画"
                  contentClassName="w-[var(--radix-select-trigger-width)]"
                  options={lyricsAnimationSelectOptions}
                  onValueChange={(value) => onLyricsAnimationModeChange(value as LyricsAnimationMode)}
                />
                <small className="text-[10px] leading-[1.45] text-[var(--flux-text-muted)]">
                  {activeLyricsAnimation?.description}
                </small>
                <div className="flex min-h-[30px] items-center gap-2">
                  <SettingsSwitch
                    checked={lyricsFocusOnly}
                    label="只显示当前歌词"
                    onCheckedChange={onLyricsFocusOnlyChange}
                  />
                  <span className="text-[10px] text-[var(--flux-text-muted)]">
                    {lyricsFocusOnly ? '隐藏上下文' : '显示前后各两句'}
                  </span>
                </div>
              </div>

              <div className="mb-[13px] grid gap-[7px] text-[11px] text-[var(--flux-text-muted)]">
                <span>歌词位置</span>
                <div className="flex min-h-[30px] items-center gap-2">
                  <SettingsSwitch
                    checked={lyricsDragEnabled}
                    label="允许拖拽歌词"
                    onCheckedChange={onLyricsDragEnabledChange}
                  />
                  <span className="mr-auto text-[10px] text-[var(--flux-text-muted)]">
                    {lyricsDragEnabled ? '移动位置' : '3D 旋转'}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-[30px] cursor-pointer rounded-lg border border-[var(--flux-glass-border)] bg-transparent text-[var(--flux-text-muted)] transition-[color,background-color] duration-[var(--motion-duration-fast)] hover:bg-[color-mix(in_srgb,var(--flux-accent)_10%,transparent)] hover:text-[var(--flux-text)] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--flux-accent)_58%,transparent)] motion-reduce:transition-none"
                    aria-label="重置歌词位置"
                    title="重置歌词位置"
                    onClick={onResetLyricsPosition}
                  >
                    <RotateCcw size={14} strokeWidth={1.8} />
                  </Button>
                </div>
              </div>

              <section
                className="my-3 grid gap-[9px] rounded-[var(--flux-radius-panel)] border border-[var(--flux-panel-border)] bg-[color-mix(in_srgb,var(--flux-panel-border)_5%,transparent)] p-3"
                aria-label="自定义背景"
              >
                <div className="flex items-start justify-between gap-2.5">
                  <span className="block">
                    <strong className="block">自定义背景</strong>
                    <small className="mt-[3px] block text-[10px] text-[var(--flux-text-muted)]">
                      图片或静音循环视频；启用后替换动态背景并保留 3D 歌词
                    </small>
                  </span>
                  {customBackground ? (
                    <em className="whitespace-nowrap text-[10px] not-italic text-[var(--flux-accent)]">
                      {backgroundMode === 'wallpaper'
                        ? '使用中'
                        : customBackground.source === 'wallpaper-engine'
                          ? '已保存 · Wallpaper Engine'
                          : '已保存 · 本地文件'}
                    </em>
                  ) : null}
                </div>
                <div className="overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-[var(--flux-text-muted)]">
                  {backgroundMode === 'wallpaper' && customBackground
                    ? `当前使用：${customBackground.name}`
                    : customBackground
                      ? `当前使用动态背景；已保存：${customBackground.name}`
                      : '当前使用动态背景'}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {customBackground ? (
                    <Button
                      type="button"
                      variant="glassRaised"
                      size="compact"
                      disabled={backgroundBusy}
                      onClick={() =>
                        onBackgroundModeChange(backgroundMode === 'wallpaper' ? 'dynamic' : 'wallpaper')
                      }
                    >
                      {backgroundMode === 'wallpaper' ? '切换到动态背景' : '启用自定义背景'}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="glassSoft"
                    size="compact"
                    disabled={backgroundBusy}
                    onClick={onChooseBackground}
                  >
                    选择图片 / 视频
                  </Button>
                  <Button
                    type="button"
                    variant="glassSoft"
                    size="compact"
                    disabled={backgroundBusy}
                    onClick={onScanWallpaperEngine}
                  >
                    扫描 Wallpaper Engine
                  </Button>
                  <Button
                    type="button"
                    variant="glassSoft"
                    size="compact"
                    disabled={backgroundBusy}
                    onClick={onChooseWallpaperEngine}
                  >
                    手选 WE 项目
                  </Button>
                  {customBackground ? (
                    <Button
                      type="button"
                      variant="glassSoft"
                      size="compact"
                      disabled={backgroundBusy}
                      onClick={onClearBackground}
                    >
                      清除
                    </Button>
                  ) : null}
                </div>
                {wallpaperProjects.length ? (
                  <div
                    className="grid max-h-[260px] grid-cols-2 gap-2 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    data-scroll-region
                    data-wallpaper-projects=""
                  >
                    {wallpaperProjects.map((project) => (
                      <Button
                        type="button"
                        key={project.id}
                        variant="glassSoft"
                        size="preview"
                        disabled={backgroundBusy}
                        onClick={() => onImportWallpaperEngine(project.id)}
                      >
                        <span className="block aspect-video w-full overflow-hidden bg-[color-mix(in_srgb,var(--flux-panel-border)_8%,transparent)]">
                          {project.previewUrl ? (
                            <img
                              className="block size-full object-cover"
                              src={project.previewUrl}
                              alt=""
                              loading="lazy"
                            />
                          ) : null}
                        </span>
                        <span className="flex min-w-0 items-center justify-between gap-1.5 px-2 py-[7px]">
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                            {project.title}
                          </span>
                          <small className="shrink-0 whitespace-nowrap text-[var(--flux-text-muted)]">
                            视频
                          </small>
                        </span>
                      </Button>
                    ))}
                  </div>
                ) : null}
                {backgroundError ? (
                  <Alert
                    variant="destructive"
                    className="m-0 text-[10px] leading-[1.45] text-[var(--flux-danger)]"
                  >
                    <AlertDescription>{backgroundError}</AlertDescription>
                  </Alert>
                ) : null}
              </section>
            </div>
          ) : (
            <Suspense
              fallback={<div className="text-[11px] text-[var(--flux-text-muted)]">正在加载维护工具…</div>}
            >
              <SystemMaintenancePanel />
            </Suspense>
          )}
        </Tabs>
      </Card>
    </SettingsDialog>
  )
}

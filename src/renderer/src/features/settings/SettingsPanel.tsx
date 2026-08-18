import { lazy, Suspense, useState } from 'react'
import { cva } from 'class-variance-authority'
import {
  Captions,
  FolderOpen,
  Image as ImageIcon,
  Palette,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { CustomBackground } from '@shared/custom-background-contract'
import type {
  WallpaperEngineLibrarySnapshot,
  WallpaperEngineSelection,
  WallpaperEngineState,
} from '@shared/wallpaper-engine-contract'
import { cn } from '@/lib/utils'
import { GlassSurface } from '../../components/glass'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { ColorPicker } from '../../components/ui/color-picker'
import { GlassSelect } from '../../components/ui/glass-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { SettingsDialog } from '../../components/shell/SettingsDialog'
import { useThemeStore } from '../../theme'
import { DYNAMIC_BACKGROUND_OPTIONS, type DynamicBackgroundEffect } from '../../visual/backgrounds'
import type { BackgroundMode } from '../../visual/background-mode'
import { LYRICS_ANIMATION_OPTIONS, type LyricsAnimationMode } from '../../visual/lyrics3d-mesh/animation'
import { WallpaperEngineLibraryDialog } from './WallpaperEngineLibraryDialog'
import { GlassSettingsTab } from './GlassSettingsTab'

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

type SettingsTab = 'theme' | 'glass' | 'background' | 'lyrics' | 'system'

const settingsTabs = [
  { value: 'theme', label: '主题', icon: Palette },
  { value: 'glass', label: '玻璃', icon: SlidersHorizontal },
  { value: 'background', label: '背景', icon: ImageIcon },
  { value: 'lyrics', label: '歌词', icon: Captions },
  { value: 'system', label: '系统', icon: Settings2 },
] as const

const settingsContentClass = [
  'h-full min-h-0 overflow-y-auto px-6 py-5 outline-none',
  '[scrollbar-color:color-mix(in_srgb,var(--flux-accent)_38%,transparent)_transparent]',
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5',
  '[&::-webkit-scrollbar-thumb]:rounded-full',
  '[&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--flux-accent)_38%,transparent)]',
].join(' ')

const settingsSectionClass = [
  'grid gap-4 border-b border-[color-mix(in_srgb,var(--flux-panel-border)_7%,transparent)] pb-5',
  'last:border-b-0 last:pb-0',
].join(' ')

const settingsRowClass = 'flex min-h-11 items-center gap-3'

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
  onChooseBackground(): void
  onClearBackground(): void
  wallpaperEngineSelection: WallpaperEngineSelection
  onWallpaperEngineStateChange(state: WallpaperEngineState): void
  onWallpaperEngineSnapshotChange(snapshot: WallpaperEngineLibrarySnapshot): void
  onWallpaperEngineDeactivate(): void
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
  onChooseBackground,
  onClearBackground,
  wallpaperEngineSelection,
  onWallpaperEngineStateChange,
  onWallpaperEngineSnapshotChange,
  onWallpaperEngineDeactivate,
  lyricsDragEnabled,
  lyricsAnimationMode,
  onLyricsAnimationModeChange,
  lyricsFocusOnly,
  onLyricsFocusOnlyChange,
  onLyricsDragEnabledChange,
  onResetLyricsPosition,
}: SettingsPanelProps): React.JSX.Element | null {
  const [activeTab, setActiveTab] = useState<SettingsTab>('theme')
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
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <GlassSurface
        elevation="raised"
        className="relative size-full min-h-0"
        contentClassName="flex size-full min-h-0 flex-col"
        data-settings-panel=""
      >
        <header className="flex h-[68px] shrink-0 items-center border-b border-[color-mix(in_srgb,var(--flux-panel-border)_7%,transparent)] px-6 pr-20">
          <div className="grid gap-0.5">
            <strong className="text-base font-semibold text-[var(--flux-text)]">设置</strong>
            <span className="text-[10px] text-[var(--flux-text-muted)]">FLUXPLAYER</span>
          </div>
        </header>

        <Tabs
          value={activeTab}
          className="min-h-0 flex-1 gap-0"
          onValueChange={(value) => setActiveTab(value as SettingsTab)}
        >
          <div className="shrink-0 px-5 py-3">
            <div
              className="w-full rounded-[var(--flux-radius-control)] border border-[var(--flux-glass-border)] bg-[var(--flux-glass-background)] p-1"
              data-settings-tabs-rail=""
            >
              <TabsList
                className="grid h-auto grid-cols-5 gap-1 border-0 bg-transparent p-0"
                aria-label="设置分类"
                data-settings-tabs=""
              >
                {settingsTabs.map((item) => {
                  const Icon = item.icon
                  return (
                    <TabsTrigger
                      key={item.value}
                      value={item.value}
                      className="h-11 min-w-0 cursor-pointer gap-2 rounded-[10px] px-3 text-[11px] font-medium text-[var(--flux-text-muted)] transition-[color,background-color,box-shadow] duration-[var(--motion-duration-fast)] hover:bg-[color-mix(in_srgb,var(--flux-panel-border)_5%,transparent)] hover:text-[var(--flux-text)] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color-mix(in_srgb,var(--flux-accent)_66%,white_8%)] data-[state=active]:bg-[color-mix(in_srgb,var(--flux-accent)_16%,var(--flux-panel-surface))] data-[state=active]:text-[var(--flux-text)] data-[state=active]:shadow-[inset_0_1px_0_color-mix(in_srgb,var(--flux-panel-border)_10%,transparent),0_8px_20px_color-mix(in_srgb,var(--flux-accent)_10%,transparent)] motion-reduce:transition-none"
                    >
                      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </div>
          </div>

          <div className="min-h-0 flex-1 border-t border-[color-mix(in_srgb,var(--flux-panel-border)_7%,transparent)]">
            <TabsContent value="theme" className={settingsContentClass} data-settings-theme="">
              <section className={settingsSectionClass} aria-labelledby="settings-theme-heading">
                <header>
                  <h2 id="settings-theme-heading" className="text-sm font-semibold text-[var(--flux-text)]">
                    主题颜色
                  </h2>
                </header>
                <ColorPicker value={accent} label="主题与灯光色" onChange={setAccent} />
              </section>
            </TabsContent>

            <TabsContent value="glass" className={settingsContentClass} data-settings-glass="">
              <GlassSettingsTab />
            </TabsContent>

            <TabsContent value="background" className={settingsContentClass} data-settings-background="">
              <div className="grid gap-5">
                <section className={settingsSectionClass} aria-labelledby="settings-dynamic-heading">
                  <header>
                    <h2
                      id="settings-dynamic-heading"
                      className="text-sm font-semibold text-[var(--flux-text)]"
                    >
                      动态背景
                    </h2>
                  </header>
                  <GlassSelect
                    value={dynamicBackground}
                    ariaLabel="动态背景"
                    contentClassName="w-[var(--radix-select-trigger-width)]"
                    options={dynamicBackgroundSelectOptions}
                    onValueChange={(value) => onDynamicBackgroundChange(value as DynamicBackgroundEffect)}
                  />
                  <span className="text-[10px] leading-[1.5] text-[var(--flux-text-muted)]">
                    {activeDynamicBackground?.description}
                  </span>
                </section>

                <section className={settingsSectionClass} aria-labelledby="settings-custom-heading">
                  <header className="flex items-center justify-between gap-3">
                    <h2
                      id="settings-custom-heading"
                      className="text-sm font-semibold text-[var(--flux-text)]"
                    >
                      本地背景
                    </h2>
                    <span className="shrink-0 text-[10px] text-[var(--flux-accent-strong)]">
                      {backgroundMode === 'wallpaper' ? '使用中' : customBackground ? '已保存' : '未设置'}
                    </span>
                  </header>
                  <p className="overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-[var(--flux-text-muted)]">
                    {customBackground?.name ?? '图片或静音循环视频'}
                  </p>
                  <div className="flex flex-wrap gap-2">
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
                        {backgroundMode === 'wallpaper' ? (
                          <Sparkles className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ImageIcon className="size-3.5" aria-hidden="true" />
                        )}
                        {backgroundMode === 'wallpaper' ? '切换到动态背景' : '启用本地背景'}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="glassSoft"
                      size="compact"
                      disabled={backgroundBusy}
                      onClick={onChooseBackground}
                    >
                      <FolderOpen className="size-3.5" aria-hidden="true" />
                      选择文件
                    </Button>
                    {customBackground ? (
                      <Button
                        type="button"
                        variant="glassSoft"
                        size="compact"
                        disabled={backgroundBusy}
                        onClick={onClearBackground}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        清除
                      </Button>
                    ) : null}
                  </div>
                  {backgroundError ? (
                    <Alert
                      variant="destructive"
                      className="m-0 text-[10px] leading-[1.45] text-[var(--flux-danger)]"
                    >
                      <AlertDescription>{backgroundError}</AlertDescription>
                    </Alert>
                  ) : null}
                </section>

                <section className={settingsSectionClass} aria-labelledby="settings-wallpaper-heading">
                  <header className="flex items-center justify-between gap-3">
                    <h2
                      id="settings-wallpaper-heading"
                      className="text-sm font-semibold text-[var(--flux-text)]"
                    >
                      Wallpaper Engine
                    </h2>
                    <span className="shrink-0 text-[10px] text-[var(--flux-accent-strong)]">
                      {wallpaperEngineSelection.active ? '使用中' : '原背景保留'}
                    </span>
                  </header>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-[var(--flux-text-muted)]">
                      {wallpaperEngineSelection.active
                        ? wallpaperEngineSelection.title || 'Wallpaper Engine 项目'
                        : '未启用'}
                    </span>
                    {wallpaperEngineSelection.active ? (
                      <Button
                        type="button"
                        variant="glassSoft"
                        size="compact"
                        className="shrink-0"
                        onClick={onWallpaperEngineDeactivate}
                      >
                        <Undo2 className="size-3.5" aria-hidden="true" />
                        恢复原背景
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <WallpaperEngineLibraryDialog
                      selection={wallpaperEngineSelection}
                      onSelectionChange={onWallpaperEngineStateChange}
                      onSnapshotChange={onWallpaperEngineSnapshotChange}
                    />
                  </div>
                  {wallpaperEngineSelection.runtimeError ? (
                    <Alert
                      variant="destructive"
                      className="m-0 text-[10px] leading-[1.45] text-[var(--flux-danger)]"
                    >
                      <AlertDescription>
                        {`Wallpaper Engine 项目不可用，已恢复原背景（${wallpaperEngineSelection.runtimeError}）`}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </section>
              </div>
            </TabsContent>

            <TabsContent value="lyrics" className={settingsContentClass} data-settings-lyrics="">
              <div className="grid gap-5">
                <section className={settingsSectionClass} aria-labelledby="settings-lyrics-color-heading">
                  <header>
                    <h2
                      id="settings-lyrics-color-heading"
                      className="text-sm font-semibold text-[var(--flux-text)]"
                    >
                      高亮颜色
                    </h2>
                  </header>
                  <div className={settingsRowClass}>
                    <span className="min-w-0 flex-1 text-[11px] font-medium text-[var(--flux-text)]">
                      跟随主题色
                    </span>
                    <span className="text-[10px] text-[var(--flux-text-muted)]">
                      {lyricsColorLinked ? '已开启' : '已关闭'}
                    </span>
                    <SettingsSwitch
                      checked={lyricsColorLinked}
                      label="歌词高亮色跟随主题"
                      onCheckedChange={setLyricsColorLinked}
                    />
                  </div>
                  {!lyricsColorLinked ? (
                    <ColorPicker
                      value={lyricsColor}
                      label="歌词颜色"
                      swatches={[]}
                      onChange={setLyricsColor}
                    />
                  ) : null}
                </section>

                <section className={settingsSectionClass} aria-labelledby="settings-lyrics-motion-heading">
                  <header>
                    <h2
                      id="settings-lyrics-motion-heading"
                      className="text-sm font-semibold text-[var(--flux-text)]"
                    >
                      显示与动效
                    </h2>
                  </header>
                  <div className="grid gap-2">
                    <span className="text-[11px] font-medium text-[var(--flux-text)]">歌词动画</span>
                    <GlassSelect
                      value={lyricsAnimationMode}
                      ariaLabel="歌词动画"
                      contentClassName="w-[var(--radix-select-trigger-width)]"
                      options={lyricsAnimationSelectOptions}
                      onValueChange={(value) => onLyricsAnimationModeChange(value as LyricsAnimationMode)}
                    />
                    <span className="text-[10px] leading-[1.5] text-[var(--flux-text-muted)]">
                      {activeLyricsAnimation?.description}
                    </span>
                  </div>
                  <div className={settingsRowClass}>
                    <span className="min-w-0 flex-1 text-[11px] font-medium text-[var(--flux-text)]">
                      只显示当前歌词
                    </span>
                    <span className="text-[10px] text-[var(--flux-text-muted)]">
                      {lyricsFocusOnly ? '隐藏上下文' : '显示上下文'}
                    </span>
                    <SettingsSwitch
                      checked={lyricsFocusOnly}
                      label="只显示当前歌词"
                      onCheckedChange={onLyricsFocusOnlyChange}
                    />
                  </div>
                </section>

                <section className={settingsSectionClass} aria-labelledby="settings-lyrics-position-heading">
                  <header>
                    <h2
                      id="settings-lyrics-position-heading"
                      className="text-sm font-semibold text-[var(--flux-text)]"
                    >
                      歌词交互
                    </h2>
                  </header>
                  <div className={settingsRowClass}>
                    <span className="min-w-0 flex-1 text-[11px] font-medium text-[var(--flux-text)]">
                      拖拽歌词
                    </span>
                    <span className="text-[10px] text-[var(--flux-text-muted)]">
                      {lyricsDragEnabled ? '移动位置' : '3D 旋转'}
                    </span>
                    <SettingsSwitch
                      checked={lyricsDragEnabled}
                      label="允许拖拽歌词"
                      onCheckedChange={onLyricsDragEnabledChange}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-11 cursor-pointer rounded-[var(--flux-radius-control)] border border-[var(--flux-glass-border)] bg-transparent text-[var(--flux-text-muted)] transition-[color,background-color] duration-[var(--motion-duration-fast)] hover:bg-[color-mix(in_srgb,var(--flux-accent)_10%,transparent)] hover:text-[var(--flux-text)] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--flux-accent)_58%,transparent)] motion-reduce:transition-none"
                      aria-label="重置歌词位置"
                      title="重置歌词位置"
                      onClick={onResetLyricsPosition}
                    >
                      <RotateCcw className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
                    </Button>
                  </div>
                </section>
              </div>
            </TabsContent>

            <TabsContent value="system" className={settingsContentClass} data-settings-system="">
              <Suspense
                fallback={
                  <div className="grid h-full place-items-center text-[11px] text-[var(--flux-text-muted)]">
                    正在加载维护工具…
                  </div>
                }
              >
                <SystemMaintenancePanel />
              </Suspense>
            </TabsContent>
          </div>
        </Tabs>
      </GlassSurface>
    </SettingsDialog>
  )
}

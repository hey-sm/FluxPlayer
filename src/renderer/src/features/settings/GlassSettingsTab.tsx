import { useEffect, useId, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  GLASS_CONFIG_LIMITS,
  normalizeGlassColor,
  useGlassStore,
  type GlassConfig,
  type GlassEditablePatch,
} from '@/components/glass'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'

type EditableNumericKey = {
  [Key in keyof GlassConfig]: GlassConfig[Key] extends number
    ? Key extends 'flexibility' | 'onHoverScale'
      ? never
      : Key
    : never
}[keyof GlassConfig]

interface NumberControl {
  key: EditableNumericKey
  label: string
  step?: number
  suffix?: string
}

interface ColorControlProps {
  configKey: 'borderColor' | 'backgroundColor' | 'innerLightColor' | 'outerLightColor' | 'color'
  label: string
  value: string
  previewConfig(patch: GlassEditablePatch): void
  commitConfig(patch?: GlassEditablePatch): void
}

const sectionClass =
  'grid gap-4 border-b border-[color-mix(in_srgb,var(--flux-panel-border)_7%,transparent)] pb-5 last:border-b-0 last:pb-0'

function GlassColorControl({
  configKey,
  label,
  value,
  previewConfig,
  commitConfig,
}: ColorControlProps): React.JSX.Element {
  const id = useId()
  const [draft, setDraft] = useState(value.toUpperCase())

  useEffect(() => setDraft(value.toUpperCase()), [value])

  const preview = (nextDraft: string): void => {
    setDraft(nextDraft)
    const normalized = normalizeGlassColor(nextDraft)
    if (normalized) previewConfig({ [configKey]: normalized })
  }

  const commit = (): void => {
    const normalized = normalizeGlassColor(draft)
    if (!normalized) {
      setDraft(value.toUpperCase())
      return
    }
    commitConfig({ [configKey]: normalized })
  }

  return (
    <div className="grid grid-cols-[minmax(110px,1fr)_42px_132px] items-center gap-3">
      <label htmlFor={id} className="text-[11px] font-medium text-[var(--flux-text)]">
        {label}
      </label>
      <input
        type="color"
        value={value.slice(0, 7)}
        className="h-8 w-[42px] cursor-pointer rounded-[var(--flux-radius-control)] border border-[var(--flux-glass-border)] bg-transparent p-1"
        aria-label={`${label}取色器`}
        onChange={(event) => {
          const next = event.currentTarget.value
          setDraft(next.toUpperCase())
          previewConfig({ [configKey]: next })
          commitConfig({ [configKey]: next })
        }}
      />
      <input
        id={id}
        type="text"
        value={draft}
        maxLength={9}
        spellCheck={false}
        className="h-8 min-w-0 rounded-[var(--flux-radius-control)] border border-[var(--flux-glass-border)] bg-[var(--flux-glass-background)] px-2.5 text-[11px] text-[var(--flux-text)] uppercase outline-none focus:border-[color-mix(in_srgb,var(--flux-accent)_55%,var(--flux-glass-border))]"
        aria-label={`${label}十六进制色值`}
        onChange={(event) => preview(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(value.toUpperCase())
            event.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}

function GlassNumberControl({
  control,
  config,
  previewConfig,
  commitConfig,
}: {
  control: NumberControl
  config: GlassConfig
  previewConfig(patch: GlassEditablePatch): void
  commitConfig(patch?: GlassEditablePatch): void
}): React.JSX.Element {
  const value = config[control.key]
  const [minimum, maximum] = GLASS_CONFIG_LIMITS[control.key]
  const output =
    control.step && control.step < 1 ? value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : value

  return (
    <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(150px,1fr)_58px] items-center gap-3">
      <span className="text-[11px] font-medium text-[var(--flux-text)]">{control.label}</span>
      <Slider
        value={[value]}
        min={minimum}
        max={maximum}
        step={control.step ?? 1}
        aria-label={control.label}
        onValueChange={([next]) => previewConfig({ [control.key]: next })}
        onValueCommit={([next]) => commitConfig({ [control.key]: next })}
      />
      <output className="text-right text-[10px] text-[var(--flux-text-muted)] tabular-nums">
        {output}
        {control.suffix}
      </output>
    </div>
  )
}

function ControlGroup({
  title,
  controls,
  children,
}: {
  title: string
  controls?: readonly NumberControl[]
  children?: React.ReactNode
}): React.JSX.Element {
  const config = useGlassStore((state) => state.config)
  const previewConfig = useGlassStore((state) => state.previewConfig)
  const commitConfig = useGlassStore((state) => state.commitConfig)

  return (
    <section className={sectionClass}>
      <h2 className="text-sm font-semibold text-[var(--flux-text)]">{title}</h2>
      <div className="grid gap-3">
        {controls?.map((control) => (
          <GlassNumberControl
            key={control.key}
            control={control}
            config={config}
            previewConfig={previewConfig}
            commitConfig={commitConfig}
          />
        ))}
        {children}
      </div>
    </section>
  )
}

const basicControls = [
  { key: 'blur', label: '模糊', suffix: 'px' },
  { key: 'distortion', label: '折射强度' },
  { key: 'saturation', label: '饱和度', suffix: '%' },
  { key: 'brightness', label: '亮度', suffix: '%' },
  { key: 'chromaticAberration', label: '色差' },
] as const satisfies readonly NumberControl[]

const borderControls = [
  { key: 'borderRadius', label: '全局圆角', suffix: 'px' },
  { key: 'borderSize', label: '边框宽度', step: 0.1, suffix: 'px' },
  { key: 'borderOpacity', label: '边框透明度', step: 0.01 },
] as const satisfies readonly NumberControl[]

const backgroundControls = [
  { key: 'backgroundOpacity', label: '背景透明度', step: 0.01 },
] as const satisfies readonly NumberControl[]

const innerControls = [
  { key: 'innerLightSpread', label: '内部光扩散', suffix: 'px' },
  { key: 'innerLightBlur', label: '内部光模糊', suffix: 'px' },
  { key: 'innerLightOpacity', label: '内部光透明度', step: 0.01 },
] as const satisfies readonly NumberControl[]

const outerControls = [
  { key: 'outerLightSpread', label: '外部光扩散', suffix: 'px' },
  { key: 'outerLightBlur', label: '外部光模糊', suffix: 'px' },
  { key: 'outerLightOpacity', label: '外部光透明度', step: 0.01 },
] as const satisfies readonly NumberControl[]

export function GlassSettingsTab(): React.JSX.Element {
  const config = useGlassStore((state) => state.config)
  const previewConfig = useGlassStore((state) => state.previewConfig)
  const commitConfig = useGlassStore((state) => state.commitConfig)
  const resetConfig = useGlassStore((state) => state.resetConfig)
  const colorProps = { previewConfig, commitConfig }

  return (
    <div className="grid gap-5" data-settings-glass-controls="">
      <ControlGroup title="基础" controls={basicControls}>
        <GlassColorControl configKey="color" label="内容颜色" value={config.color} {...colorProps} />
      </ControlGroup>
      <ControlGroup title="边框" controls={borderControls}>
        <GlassColorControl
          configKey="borderColor"
          label="边框颜色"
          value={config.borderColor}
          {...colorProps}
        />
      </ControlGroup>
      <ControlGroup title="背景" controls={backgroundControls}>
        <GlassColorControl
          configKey="backgroundColor"
          label="背景颜色"
          value={config.backgroundColor}
          {...colorProps}
        />
      </ControlGroup>
      <ControlGroup title="内部光照" controls={innerControls}>
        <GlassColorControl
          configKey="innerLightColor"
          label="内部光颜色"
          value={config.innerLightColor}
          {...colorProps}
        />
      </ControlGroup>
      <ControlGroup title="外部光照" controls={outerControls}>
        <GlassColorControl
          configKey="outerLightColor"
          label="外部光颜色"
          value={config.outerLightColor}
          {...colorProps}
        />
      </ControlGroup>
      <footer className="flex justify-end pb-1">
        <Button type="button" variant="glassSoft" size="compact" onClick={resetConfig}>
          <RotateCcw className="size-3.5" aria-hidden="true" />
          恢复默认
        </Button>
      </footer>
    </div>
  )
}

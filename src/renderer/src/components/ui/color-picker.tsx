import { useEffect, useId, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalizeHexColor } from '@/theme/values'

export interface ColorSwatch {
  name: string
  label: string
  value: string
}

/** Tailwind CSS palette, shade 500. */
export const TAILWIND_COLOR_SWATCHES: readonly ColorSwatch[] = Object.freeze([
  { name: 'bg-red-500', label: '红色', value: '#ef4444' },
  { name: 'bg-amber-500', label: '琥珀', value: '#f59e0b' },
  { name: 'bg-green-500', label: '绿色', value: '#22c55e' },
  { name: 'bg-blue-500', label: '蓝色', value: '#3b82f6' },
  { name: 'bg-indigo-500', label: '靛蓝', value: '#6366f1' },
  { name: 'bg-violet-500', label: '紫罗兰', value: '#8b5cf6' },
  { name: 'bg-purple-500', label: '紫色', value: '#a855f7' },
  { name: 'bg-pink-500', label: '粉色', value: '#ec4899' },
  { name: 'bg-slate-500', label: '石板', value: '#64748b' },
])

const colorInputClass = [
  'h-9 rounded-[var(--flux-radius-control)] border border-[var(--flux-glass-border)]',
  'bg-[color-mix(in_srgb,var(--flux-panel-surface)_64%,transparent)]',
  'focus-visible:outline-2 focus-visible:outline-offset-2',
  'focus-visible:outline-[color-mix(in_srgb,var(--flux-accent)_72%,white_8%)]',
].join(' ')

export function ColorPicker({
  value,
  onChange,
  label,
  description,
  swatches = TAILWIND_COLOR_SWATCHES,
  className,
}: {
  value: string
  onChange(value: string): void
  label: string
  description?: string
  swatches?: readonly ColorSwatch[]
  className?: string
}): React.JSX.Element {
  const id = useId()
  const [draft, setDraft] = useState(value.toUpperCase())

  useEffect(() => setDraft(value.toUpperCase()), [value])

  const commitDraft = (nextDraft: string): void => {
    setDraft(nextDraft)
    const normalized = normalizeHexColor(nextDraft)
    if (normalized) onChange(normalized)
  }

  return (
    <div className={cn('grid gap-2', className)} data-color-picker="">
      <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-[var(--flux-text)]">
        <label htmlFor={`${id}-native`}>{label}</label>
        <code className="text-[10px] font-normal text-[var(--flux-text-muted)]">{value.toUpperCase()}</code>
      </div>
      {description ? (
        <small className="text-[10px] leading-[1.45] font-normal text-[var(--flux-text-muted)]">
          {description}
        </small>
      ) : null}
      <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-2">
        <input
          id={`${id}-native`}
          type="color"
          value={value}
          className={cn(colorInputClass, 'w-10 cursor-pointer p-[3px]')}
          aria-label={`${label}取色器`}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <input
          type="text"
          value={draft}
          maxLength={7}
          spellCheck={false}
          className={cn(
            colorInputClass,
            'min-w-0 px-2.5 text-[11px] leading-none font-medium tracking-[0.06em] text-[var(--flux-text)] uppercase [font-family:var(--flux-font-family)]',
          )}
          aria-label={`${label}十六进制色值`}
          onChange={(event) => commitDraft(event.currentTarget.value)}
          onBlur={() => setDraft(value.toUpperCase())}
        />
      </div>
      {swatches.length ? (
        <div className="flex flex-wrap gap-1" aria-label="Tailwind 色板" data-color-swatches="">
          {swatches.map((swatch) => {
            const selected = swatch.value.toLowerCase() === value.toLowerCase()
            return (
              <button
                key={swatch.name}
                type="button"
                className={cn(
                  'grid size-6 cursor-pointer place-items-center rounded-[5px] border p-0 text-white',
                  'border-[color-mix(in_srgb,var(--swatch-color)_70%,white_30%)] bg-[var(--swatch-color)]',
                  'shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition-[border-color,filter] duration-[var(--motion-duration-fast)]',
                  'hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2',
                  'focus-visible:outline-[color-mix(in_srgb,var(--flux-accent)_72%,white_8%)] motion-reduce:transition-none',
                  selected &&
                    'border-white shadow-[0_0_0_2px_color-mix(in_srgb,var(--swatch-color)_52%,transparent),inset_0_1px_0_rgba(255,255,255,0.24)]',
                )}
                style={{ '--swatch-color': swatch.value } as React.CSSProperties}
                aria-label={`${swatch.label}，${swatch.name}`}
                aria-pressed={selected}
                title={swatch.name}
                onClick={() => onChange(swatch.value)}
              >
                {selected ? (
                  <Check className="size-3 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]" aria-hidden="true" />
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

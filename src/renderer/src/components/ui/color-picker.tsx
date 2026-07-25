import { useEffect, useId, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalizeHexColor } from '@/theme/values'

export interface ColorSwatch {
  name: string
  label: string
  value: string
}

/** Tailwind CSS default palette, shade 500. */
export const TAILWIND_COLOR_SWATCHES: readonly ColorSwatch[] = Object.freeze([
  { name: 'red-500', label: '红色', value: '#ef4444' },
  { name: 'orange-500', label: '橙色', value: '#f97316' },
  { name: 'amber-500', label: '琥珀', value: '#f59e0b' },
  { name: 'green-500', label: '绿色', value: '#22c55e' },
  { name: 'cyan-500', label: '青色', value: '#06b6d4' },
  { name: 'blue-500', label: '蓝色', value: '#3b82f6' },
  { name: 'indigo-500', label: '靛蓝', value: '#6366f1' },
  { name: 'violet-500', label: '紫罗兰', value: '#8b5cf6' },
  { name: 'fuchsia-500', label: '品红', value: '#d946ef' },
  { name: 'rose-500', label: '玫红', value: '#f43f5e' },
])

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
    <div className={cn('color-picker', className)}>
      <div className="color-picker-heading">
        <label htmlFor={`${id}-native`}>{label}</label>
        <code>{value.toUpperCase()}</code>
      </div>
      {description ? <small>{description}</small> : null}
      <div className="color-picker-controls">
        <input
          id={`${id}-native`}
          type="color"
          value={value}
          aria-label={`${label}取色器`}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <input
          type="text"
          value={draft}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label}十六进制色值`}
          onChange={(event) => commitDraft(event.currentTarget.value)}
          onBlur={() => setDraft(value.toUpperCase())}
        />
      </div>
      {swatches.length ? (
        <div className="color-swatch-list" aria-label="Tailwind 默认色">
          {swatches.map((swatch) => {
            const selected = swatch.value.toLowerCase() === value.toLowerCase()
            return (
              <button
                key={swatch.name}
                type="button"
                className="color-swatch"
                style={{ '--swatch-color': swatch.value } as React.CSSProperties}
                aria-label={`${swatch.label}，${swatch.name}`}
                aria-pressed={selected}
                title={swatch.name}
                onClick={() => onChange(swatch.value)}
              >
                {selected ? <Check aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

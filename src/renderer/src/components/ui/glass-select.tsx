import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { LiquidGlassSurface } from '@/components/glass'
import { cn } from '@/lib/utils'

export interface GlassSelectOption {
  value: string
  label: React.ReactNode
  textValue?: string
  trailing?: React.ReactNode
}

interface GlassSelectProps {
  value: string
  options: readonly GlassSelectOption[]
  ariaLabel: string
  onValueChange(value: string): void
  disabled?: boolean
  side?: 'top' | 'bottom'
  title?: string
  className?: string
  contentClassName?: string
  renderValue?(option: GlassSelectOption | undefined): React.ReactNode
}

/** Shared liquid-glass select used by compact player and settings controls. */
export function GlassSelect({
  value,
  options,
  ariaLabel,
  onValueChange,
  disabled = false,
  side = 'bottom',
  title,
  className,
  contentClassName,
  renderValue,
}: GlassSelectProps): React.JSX.Element {
  const selected = options.find((option) => option.value === value)

  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        title={title}
        className={cn('glass-select-trigger', className)}
      >
        <span className="glass-select-value">
          {renderValue ? renderValue(selected) : selected?.label}
        </span>
        <SelectPrimitive.Icon className="glass-select-chevron">
          <ChevronDown aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          side={side}
          sideOffset={8}
          collisionPadding={10}
          className={cn('glass-select-content', contentClassName)}
        >
          <LiquidGlassSurface className="glass-select-surface">
            <SelectPrimitive.Viewport className="glass-select-viewport">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  textValue={option.textValue ?? (typeof option.label === 'string' ? option.label : undefined)}
                  className="glass-select-item"
                >
                  <span className="glass-select-check">
                    <SelectPrimitive.ItemIndicator>
                      <Check aria-hidden="true" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  {option.trailing ? <span className="glass-select-trailing">{option.trailing}</span> : null}
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </LiquidGlassSurface>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

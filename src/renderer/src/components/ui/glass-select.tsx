import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronDown } from 'lucide-react'
import { LiquidGlassSurface } from '@/components/glass'
import { cn } from '@/lib/utils'
import { gsap, motionDurations, motionEases, useGSAP, useReducedMotion } from '@/motion'

export interface GlassSelectOption {
  value: string
  label: React.ReactNode
  textValue?: string
  trailing?: React.ReactNode
}

export const glassSelectTriggerVariants = cva(
  [
    'inline-flex h-[34px] w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--flux-radius-control)] border px-2.5',
    'border-[var(--flux-glass-border)] bg-[color-mix(in_srgb,var(--flux-panel-surface)_72%,transparent)]',
    'text-[11px] text-[var(--flux-text)] outline-none [font-family:var(--flux-font-family)]',
    'transition-[border-color,background-color,color] duration-[var(--motion-duration-fast)] motion-reduce:transition-none',
    'hover:border-[color-mix(in_srgb,var(--flux-accent)_42%,var(--flux-glass-border))]',
    'hover:bg-[color-mix(in_srgb,var(--flux-accent)_10%,var(--flux-panel-surface))]',
    'data-[state=open]:border-[color-mix(in_srgb,var(--flux-accent)_42%,var(--flux-glass-border))]',
    'data-[state=open]:bg-[color-mix(in_srgb,var(--flux-accent)_10%,var(--flux-panel-surface))]',
    'focus-visible:border-[color-mix(in_srgb,var(--flux-accent)_42%,var(--flux-glass-border))]',
    'focus-visible:bg-[color-mix(in_srgb,var(--flux-accent)_10%,var(--flux-panel-surface))]',
    'focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--flux-accent)_26%,transparent)]',
    'disabled:cursor-default disabled:opacity-55',
  ],
  {
    variants: {
      variant: {
        default: '',
        compact: [
          'h-[34px] w-auto min-w-0 flex-none gap-0 border-0 bg-transparent p-0 shadow-none!',
          'hover:bg-transparent hover:text-[var(--flux-accent)]',
          'data-[state=open]:bg-transparent data-[state=open]:text-[var(--flux-accent)]',
          'focus-visible:bg-transparent focus-visible:text-[var(--flux-accent)] focus-visible:ring-0',
          'focus-visible:underline focus-visible:underline-offset-[3px]',
          '[&_[data-glass-select-chevron]]:hidden',
        ],
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

interface GlassSelectProps extends VariantProps<typeof glassSelectTriggerVariants> {
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
  variant,
}: GlassSelectProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [contentMounted, setContentMounted] = React.useState(false)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const chevronRef = React.useRef<HTMLSpanElement>(null)
  const reducedMotion = useReducedMotion()
  const selected = options.find((option) => option.value === value)

  useGSAP(
    () => {
      const content = contentRef.current
      const chevron = chevronRef.current
      gsap.killTweensOf([content, chevron])

      gsap.to(chevron, {
        rotate: open ? 180 : 0,
        duration: reducedMotion ? 0 : motionDurations.fast,
        ease: motionEases.standard,
        overwrite: 'auto',
      })

      if (!content) return
      const hiddenY = side === 'top' ? 4 : -4
      if (open) {
        gsap.fromTo(
          content,
          { autoAlpha: 0, y: hiddenY, scale: 0.98 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: reducedMotion ? 0 : motionDurations.base,
            ease: motionEases.enter,
            overwrite: 'auto',
          },
        )
      } else if (reducedMotion) {
        gsap.set(content, { autoAlpha: 0, y: hiddenY, scale: 0.98 })
        setContentMounted(false)
      } else {
        gsap.to(content, {
          autoAlpha: 0,
          y: hiddenY,
          scale: 0.98,
          duration: motionDurations.fast,
          ease: motionEases.exit,
          overwrite: 'auto',
          onComplete: () => setContentMounted(false),
        })
      }

      return () => gsap.killTweensOf([content, chevron])
    },
    { dependencies: [contentMounted, open, reducedMotion, side] },
  )

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) setContentMounted(true)
    setOpen(nextOpen)
  }

  return (
    <SelectPrimitive.Root
      value={value}
      open={open}
      onOpenChange={handleOpenChange}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        title={title}
        className={cn(glassSelectTriggerVariants({ variant }), className)}
        data-glass-select-trigger=""
      >
        <span className="inline-flex min-w-0 items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap">
          {renderValue ? renderValue(selected) : selected?.label}
        </span>
        <SelectPrimitive.Icon asChild>
          <span
            ref={chevronRef}
            className="grid shrink-0 place-items-center text-[var(--flux-text-muted)]"
            data-glass-select-chevron=""
          >
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </span>
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      {contentMounted ? (
        <SelectPrimitive.Portal forceMount>
          <SelectPrimitive.Content
            ref={contentRef}
            forceMount
            position="popper"
            side={side}
            sideOffset={8}
            collisionPadding={10}
            className={cn(
              'z-[130] max-h-[min(280px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden',
              'text-[var(--flux-text)] [transform-origin:var(--radix-select-content-transform-origin)]',
              'data-[state=closed]:pointer-events-none',
              contentClassName,
            )}
            data-glass-select-content=""
          >
            <LiquidGlassSurface className="flex max-h-[min(280px,var(--radix-select-content-available-height))] w-full flex-col overflow-hidden">
              <SelectPrimitive.Viewport
                className={cn(
                  'min-h-0 w-full max-h-[min(280px,var(--radix-select-content-available-height))] overflow-y-auto',
                  '[scrollbar-color:color-mix(in_srgb,var(--flux-accent)_45%,transparent)_transparent] [scrollbar-width:thin]',
                  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full',
                  '[&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--flux-accent)_45%,transparent)]',
                )}
              >
                {options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    textValue={
                      option.textValue ?? (typeof option.label === 'string' ? option.label : undefined)
                    }
                    className={cn(
                      'grid min-h-[34px] w-full cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-[7px] rounded-[var(--flux-radius-control)] px-2',
                      'text-[11px] text-[var(--flux-text)] outline-none select-none',
                      'data-[highlighted]:bg-[color-mix(in_srgb,var(--flux-accent)_14%,transparent)]',
                      'data-[state=checked]:bg-[color-mix(in_srgb,var(--flux-accent)_14%,transparent)]',
                    )}
                    data-glass-select-item=""
                  >
                    <span className="grid size-4 place-items-center text-[var(--flux-accent)]">
                      <SelectPrimitive.ItemIndicator>
                        <Check className="size-[13px]" aria-hidden="true" />
                      </SelectPrimitive.ItemIndicator>
                    </span>
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    {option.trailing ? (
                      <span className="text-[9px] text-[var(--flux-accent)]">{option.trailing}</span>
                    ) : null}
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
            </LiquidGlassSurface>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      ) : null}
    </SelectPrimitive.Root>
  )
}

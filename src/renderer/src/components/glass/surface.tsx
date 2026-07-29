import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type GlassTreatment = 'theme' | 'classicPanel'
export type GlassEdge = 'none' | 'left' | 'right'

export const glassSurfaceVariants = cva(
  [
    'text-[var(--flux-text)]',
    '[font-family:var(--flux-font-family)]',
    '[font-size:calc(1em*var(--flux-font-scale))]',
    '[filter:none]',
  ],
  {
    variants: {
      treatment: {
        theme: [
          'border border-[var(--flux-glass-border)] bg-[var(--flux-glass-background)]',
          '[-webkit-backdrop-filter:blur(var(--flux-glass-blur))_saturate(var(--flux-glass-saturation))]',
          '[backdrop-filter:blur(var(--flux-glass-blur))_saturate(var(--flux-glass-saturation))]',
          '[box-shadow:inset_0_1px_0_color-mix(in_srgb,var(--flux-panel-border)_5%,transparent)]',
        ],
        classicPanel: [
          'border-0 bg-[var(--saved-panel-glass-bg)]',
          '[-webkit-backdrop-filter:var(--saved-panel-glass-filter)]',
          '[backdrop-filter:var(--saved-panel-glass-filter)]',
          '[box-shadow:var(--saved-panel-glass-shadow)]',
        ],
      },
      elevation: {
        flat: '',
        raised: '[box-shadow:var(--flux-shadow-raised)]',
      },
      interactive: {
        false: '',
        true: [
          'transition-[border-color,background-color] duration-[var(--motion-duration-fast)]',
          'hover:[border-color:color-mix(in_srgb,var(--flux-panel-border)_16%,transparent)]',
          'motion-reduce:transition-none',
        ],
      },
      edge: {
        none: 'rounded-[var(--flux-glass-radius)]',
        left: 'rounded-l-none rounded-r-[15px]',
        right: 'rounded-r-none rounded-l-[15px]',
      },
    },
    defaultVariants: {
      treatment: 'theme',
      elevation: 'flat',
      interactive: false,
      edge: 'none',
    },
  },
)

export interface GlassSurfaceProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof glassSurfaceVariants> {}

/**
 * CSS-only glass for top bars, sidebars, player bars, sheets, and other large
 * surfaces. This component never renders SVG and never uses displacement maps.
 */
export const GlassSurface = forwardRef<HTMLDivElement, GlassSurfaceProps>(function GlassSurface(
  { className, elevation, interactive, treatment, edge, ...props },
  ref,
) {
  return (
    <div
      {...props}
      ref={ref}
      className={cn(glassSurfaceVariants({ elevation, interactive, treatment, edge }), className)}
      data-flux-glass-surface=""
      data-elevation={elevation ?? 'flat'}
      data-treatment={treatment ?? 'theme'}
      data-edge={edge ?? 'none'}
    />
  )
})

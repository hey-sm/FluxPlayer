import { forwardRef, type HTMLAttributes } from 'react'

export interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: 'flat' | 'raised'
  interactive?: boolean
}

/**
 * CSS-only glass for top bars, sidebars, player bars, sheets, and other large
 * surfaces. This component never renders SVG and never uses displacement maps.
 */
export const GlassSurface = forwardRef<HTMLDivElement, GlassSurfaceProps>(function GlassSurface(
  { className, elevation = 'flat', interactive = false, ...props },
  ref,
) {
  const classes = [
    'flux-glass-surface',
    interactive ? 'flux-glass-surface--interactive' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div {...props} ref={ref} className={classes} data-flux-glass-surface="" data-elevation={elevation} />
  )
})

import { GlassCard } from 'react-glass-ui'
import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { useGlassStore } from './store'

export type GlassEdge = 'none' | 'left' | 'right'

export interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  edge?: GlassEdge
  contentClassName?: string
  elevation?: 'flat' | 'raised'
}

/** The only project adapter allowed to render react-glass-ui's GlassCard. */
export const GlassSurface = forwardRef<HTMLDivElement, GlassSurfaceProps>(function GlassSurface(
  { children, className, contentClassName, edge = 'none', elevation = 'flat', style, ...props },
  ref,
) {
  const config = useGlassStore((state) => state.config)
  const localStyle = { ...style, '--flux-text': config.color } as CSSProperties

  return (
    <div
      {...props}
      ref={ref}
      className={cn('flux-glass-surface', className)}
      style={localStyle}
      data-flux-glass-surface=""
      data-glass-scope="global"
      data-glass-config={JSON.stringify(config)}
      data-elevation={elevation}
      data-edge={edge}
    >
      <GlassCard
        {...config}
        padding="0"
        className="flux-glass-surface__card"
        contentClassName={cn('flux-glass-surface__content', contentClassName)}
      >
        {children}
      </GlassCard>
    </div>
  )
})

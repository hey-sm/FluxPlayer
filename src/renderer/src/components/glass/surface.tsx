import { GlassCard } from 'react-glass-ui'
import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import {
  glassConfigToSurfaceCssVariables,
  resolveGlassSurfaceConfig,
  type GlassSurfaceConfig,
} from './config'
import { useGlassStore } from './store'

export type GlassEdge = 'none' | 'left' | 'right'

export interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  edge?: GlassEdge
  contentClassName?: string
  elevation?: 'flat' | 'raised'
  glassConfig?: GlassSurfaceConfig
}

/** The only project adapter allowed to render react-glass-ui's GlassCard. */
export const GlassSurface = forwardRef<HTMLDivElement, GlassSurfaceProps>(function GlassSurface(
  { children, className, contentClassName, edge = 'none', elevation = 'flat', glassConfig, style, ...props },
  ref,
) {
  const globalConfig = useGlassStore((state) => state.config)
  const config = resolveGlassSurfaceConfig(globalConfig, glassConfig)
  const localStyle = { ...style, ...glassConfigToSurfaceCssVariables(config) } as CSSProperties

  return (
    <div
      {...props}
      ref={ref}
      className={cn('flux-glass-surface', className)}
      style={localStyle}
      data-flux-glass-surface=""
      data-glass-scope={glassConfig ? 'local' : 'global'}
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

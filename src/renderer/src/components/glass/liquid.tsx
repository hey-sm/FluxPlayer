import { GlassCard } from 'react-glass-ui'
import type { HTMLAttributes, ReactNode } from 'react'

export interface LiquidGlassSurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children?: ReactNode
  compact?: boolean
}

/** Project adapter: third-party liquid glass is limited to compact overlays. */
export function LiquidGlassSurface({
  children,
  className = '',
  compact = true,
  ...props
}: LiquidGlassSurfaceProps) {
  return (
    <div {...props} className={`flux-liquid-glass ${className}`} data-compact={compact ? '' : undefined}>
      <GlassCard
        avoidSvgCreation={!compact}
        blur={18}
        distortion={compact ? 3 : 0}
        chromaticAberration={compact ? 0.5 : 0}
        borderRadius={14}
        borderOpacity={0.14}
        backgroundColor="#101015"
        backgroundOpacity={0.72}
        saturation={125}
        padding="6px"
        contentClassName="flux-liquid-glass__content"
      >
        {children}
      </GlassCard>
    </div>
  )
}

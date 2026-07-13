import './glass.css'
import { GlassButton, GlassCard, GlassInput } from './adapters'
import { GlassSurface } from './surface'

/** The sole business-facing entrypoint for all glass implementations. */
export const Glass = Object.freeze({
  Surface: GlassSurface,
  Card: GlassCard,
  Button: GlassButton,
  Input: GlassInput,
})

export { GlassButton, GlassCard, GlassInput, GlassSurface }
export type { GlassButtonProps, GlassCardProps, GlassInputProps } from './adapters'
export type { GlassSurfaceProps } from './surface'

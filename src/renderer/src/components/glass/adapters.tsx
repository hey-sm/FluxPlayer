import type { ComponentProps } from 'react'
import {
  GlassButton as ReactGlassButton,
  GlassCard as ReactGlassCard,
  GlassInput as ReactGlassInput,
} from 'react-glass-ui'
import { useThemeStore } from '../../theme/store'

export type GlassCardProps = ComponentProps<typeof ReactGlassCard>
export type GlassButtonProps = ComponentProps<typeof ReactGlassButton>
export type GlassInputProps = ComponentProps<typeof ReactGlassInput>

type ThemedGlassProps = Pick<
  GlassCardProps,
  | 'blur'
  | 'saturation'
  | 'distortion'
  | 'chromaticAberration'
  | 'borderRadius'
  | 'borderOpacity'
  | 'borderColor'
  | 'backgroundColor'
  | 'backgroundOpacity'
  | 'color'
>

function useThemedGlassProps(): ThemedGlassProps {
  const visual = useThemeStore((state) => state.visualParams)
  return {
    blur: visual.blur,
    saturation: visual.saturation,
    distortion: visual.distortion,
    chromaticAberration: visual.chromaticAberration,
    borderRadius: visual.radius,
    borderOpacity: visual.borderOpacity,
    borderColor: visual.panelBorder,
    backgroundColor: visual.panelSurface,
    backgroundOpacity: visual.backgroundOpacity,
    color: visual.text,
  }
}

function shouldAvoidSvg(
  explicit: boolean | undefined,
  distortion: number | undefined,
  chromaticAberration: number | undefined,
): boolean {
  if (explicit !== undefined) return explicit
  return (distortion ?? 0) <= 0 && (chromaticAberration ?? 0) <= 0
}

/**
 * Theme-aware adapter for compact cards. Large layout panels must use
 * GlassSurface, whose implementation cannot create SVG displacement filters.
 */
export function GlassCard(props: GlassCardProps): React.JSX.Element {
  const themed = useThemedGlassProps()
  const distortion = props.distortion ?? themed.distortion
  const chromaticAberration = props.chromaticAberration ?? themed.chromaticAberration

  return (
    <ReactGlassCard
      {...themed}
      {...props}
      className={`flux-glass-card${props.className ? ` ${props.className}` : ''}`}
      distortion={distortion}
      chromaticAberration={chromaticAberration}
      avoidSvgCreation={shouldAvoidSvg(props.avoidSvgCreation, distortion, chromaticAberration)}
    />
  )
}

export function GlassButton(props: GlassButtonProps): React.JSX.Element {
  const themed = useThemedGlassProps()
  const distortion = props.distortion ?? themed.distortion
  const chromaticAberration = props.chromaticAberration ?? themed.chromaticAberration

  return (
    <ReactGlassButton
      {...themed}
      {...props}
      className={`flux-glass-button${props.className ? ` ${props.className}` : ''}`}
      distortion={distortion}
      chromaticAberration={chromaticAberration}
      avoidSvgCreation={shouldAvoidSvg(props.avoidSvgCreation, distortion, chromaticAberration)}
    />
  )
}

export function GlassInput(props: GlassInputProps): React.JSX.Element {
  const themed = useThemedGlassProps()
  const textMuted = useThemeStore((state) => state.visualParams.textMuted)
  const distortion = props.distortion ?? themed.distortion
  const chromaticAberration = props.chromaticAberration ?? themed.chromaticAberration

  return (
    <ReactGlassInput
      {...themed}
      {...props}
      className={`flux-glass-input${props.className ? ` ${props.className}` : ''}`}
      labelColor={props.labelColor ?? textMuted}
      distortion={distortion}
      chromaticAberration={chromaticAberration}
      avoidSvgCreation={shouldAvoidSvg(props.avoidSvgCreation, distortion, chromaticAberration)}
    />
  )
}

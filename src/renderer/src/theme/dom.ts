import type { ThemeVisualParams } from './types'

export interface ThemeStyleTarget {
  setProperty(name: string, value: string): void
}

export interface ThemeDocumentTarget {
  documentElement?: {
    style?: ThemeStyleTarget | null
  } | null
}

export const THEME_CSS_VARIABLE_NAMES = Object.freeze({
  background: '--flux-bg',
  text: '--flux-text',
  textMuted: '--flux-text-muted',
  accent: '--flux-accent',
  danger: '--flux-danger',
  panelSurface: '--flux-panel-surface',
  panelBorder: '--flux-panel-border',
  blur: '--flux-glass-blur',
  saturation: '--flux-glass-saturation',
  backgroundOpacity: '--flux-glass-bg-opacity',
  borderOpacity: '--flux-glass-border-opacity',
  distortion: '--flux-glass-distortion',
  chromaticAberration: '--flux-glass-chromatic-aberration',
  radius: '--flux-glass-radius',
  fontFamily: '--flux-font-family',
  fontScale: '--flux-font-scale',
} as const satisfies Readonly<Record<keyof ThemeVisualParams, `--flux-${string}`>>)

export type ThemeCssVariableName = (typeof THEME_CSS_VARIABLE_NAMES)[keyof ThemeVisualParams]
export type ThemeCssVariables = Readonly<Record<ThemeCssVariableName, string>>

export function resolveDocumentThemeStyle(
  documentTarget?: ThemeDocumentTarget | null,
): ThemeStyleTarget | null {
  try {
    const target =
      documentTarget === undefined
        ? ((globalThis as { document?: ThemeDocumentTarget }).document ?? null)
        : documentTarget
    const style = target?.documentElement?.style
    return style && typeof style.setProperty === 'function' ? style : null
  } catch {
    return null
  }
}

export function themeVisualParamsToCssVariables(params: Readonly<ThemeVisualParams>): ThemeCssVariables {
  return {
    '--flux-bg': params.background,
    '--flux-text': params.text,
    '--flux-text-muted': params.textMuted,
    '--flux-accent': params.accent,
    '--flux-danger': params.danger,
    '--flux-panel-surface': params.panelSurface,
    '--flux-panel-border': params.panelBorder,
    '--flux-glass-blur': `${params.blur}px`,
    '--flux-glass-saturation': `${params.saturation}%`,
    '--flux-glass-bg-opacity': String(params.backgroundOpacity),
    '--flux-glass-border-opacity': String(params.borderOpacity),
    '--flux-glass-distortion': String(params.distortion),
    '--flux-glass-chromatic-aberration': String(params.chromaticAberration),
    '--flux-glass-radius': `${params.radius}px`,
    '--flux-font-family': params.fontFamily,
    '--flux-font-scale': String(params.fontScale),
  }
}

/** Writes a complete variable set in one synchronous pass. Safe in Node/SSR. */
function preferredColorScheme(background: string): 'light' | 'dark' {
  const match = /^#([0-9a-f]{6})$/i.exec(background.trim())
  if (!match) return 'dark'
  const value = Number.parseInt(match[1], 16)
  const red = (value >> 16) & 0xff
  const green = (value >> 8) & 0xff
  const blue = value & 0xff
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 >= 160 ? 'light' : 'dark'
}

export function applyThemeVariables(
  params: Readonly<ThemeVisualParams>,
  styleTarget: ThemeStyleTarget | null = resolveDocumentThemeStyle(),
): boolean {
  if (!styleTarget) return false

  try {
    const variables = themeVisualParamsToCssVariables(params)
    for (const [name, value] of Object.entries(variables)) {
      styleTarget.setProperty(name, value)
    }
    styleTarget.setProperty('--flux-color-scheme', preferredColorScheme(params.background))
    return true
  } catch {
    return false
  }
}

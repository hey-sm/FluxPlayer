export type ThemePresetId = 'classic-gold'

/** Serializable classic-theme values consumed as CSS variables. */
export interface ThemeVisualParams {
  background: string
  text: string
  textMuted: string
  accent: string
  danger: string
  panelSurface: string
  panelBorder: string
  blur: number
  saturation: number
  backgroundOpacity: number
  borderOpacity: number
  distortion: number
  chromaticAberration: number
  radius: number
  fontFamily: string
  fontScale: number
}

export interface ThemePreset {
  id: ThemePresetId
  label: string
  description: string
  visualParams: Readonly<ThemeVisualParams>
}

export interface ThemeSnapshot {
  selectedPresetId: ThemePresetId
  visualParams: ThemeVisualParams
}

export type ThemeVisualPatch = Partial<ThemeVisualParams>

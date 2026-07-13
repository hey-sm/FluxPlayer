import type { ThemePreset, ThemeVisualParams } from '../types'

export const CLASSIC_GOLD_THEME_ID = 'classic-gold' as const

const CLASSIC_GOLD_VISUAL_PARAMS = Object.freeze({
  background: '#000000',
  text: '#ffffff',
  textMuted: '#8a9099',
  accent: '#00f5d4',
  danger: '#d95b67',
  panelSurface: '#000000',
  panelBorder: '#ffffff',
  blur: 12,
  saturation: 180,
  backgroundOpacity: 0.1,
  borderOpacity: 0,
  distortion: 0,
  chromaticAberration: 0,
  radius: 50,
  fontFamily:
    "'Noto Sans SC', 'PingFang SC', 'HarmonyOS Sans SC', 'Alibaba PuHuiTi', Inter, system-ui, sans-serif",
  fontScale: 1,
} satisfies ThemeVisualParams)

/** Golden legacy glass preset. Large surfaces remain CSS-only; the player strip is the SVG exception. */
export const CLASSIC_GOLD_THEME = Object.freeze({
  id: CLASSIC_GOLD_THEME_ID,
  label: '经典',
  description: '保留旧版黄金参数的经典玻璃；大面积表面使用 CSS，控制条保留 SVG 折射。',
  visualParams: CLASSIC_GOLD_VISUAL_PARAMS,
} satisfies ThemePreset)

/**
 * Exact legacy CSS values for broad panels and buttons. The SVG filter is deliberately
 * absent: it is an explicit control-strip exception, not a replacement for broad CSS glass.
 */
export const CLASSIC_GLASS_CSS_VARIABLES = Object.freeze({
  '--saved-panel-glass-bg': 'rgba(0,0,0,.10)',
  '--saved-panel-glass-filter': 'blur(12px) saturate(1.8) brightness(1.16)',
  '--saved-panel-glass-shadow':
    'inset 0 0 2px 1px rgba(255,255,255,.35),inset 0 0 10px 4px rgba(255,255,255,.15),0 4px 16px rgba(17,17,26,.05),0 8px 24px rgba(17,17,26,.05),0 16px 56px rgba(17,17,26,.05),inset 0 4px 16px rgba(17,17,26,.05),inset 0 8px 24px rgba(17,17,26,.05),inset 0 16px 56px rgba(17,17,26,.05)',
  '--saved-panel-glass-radius': '50px',
  '--saved-button-glass-bg': 'rgba(0,0,0,.10)',
  '--saved-button-glass-filter': 'blur(12px) saturate(1.8) brightness(1.16)',
  '--saved-button-glass-shadow':
    'inset 0 0 2px 1px rgba(255,255,255,.34),inset 0 0 10px 4px rgba(255,255,255,.13),0 10px 30px rgba(0,0,0,.18)',
  '--saved-button-glass-hover-bg': 'rgba(255,255,255,.055)',
  '--saved-button-glass-hover-shadow':
    'inset 0 0 2px 1px rgba(255,255,255,.42),inset 0 0 12px 5px rgba(255,255,255,.17),0 12px 34px rgba(0,0,0,.22),0 0 18px rgba(255,255,255,.06)',
} as const)

export type ClassicGlassCssVariableName = keyof typeof CLASSIC_GLASS_CSS_VARIABLES

export const CLASSIC_GLASS_FILTER_ID = 'mineradio-control-glass-filter'
export const CLASSIC_GLASS_MAP_ID = 'control-glass-map'

export const CLASSIC_GLASS_FILTER_REGION = Object.freeze({
  x: '-12%',
  y: '-28%',
  width: '124%',
  height: '156%',
} as const)

export const CLASSIC_GLASS_DISPLACEMENT_SCALES = Object.freeze({
  red: 180,
  green: 170,
  blue: 160,
} as const)

export const CLASSIC_GLASS_CHROMATIC_OFFSET = Object.freeze({ dx: -90, dy: 0 } as const)
export const CLASSIC_GLASS_BLEND_MODE = 'screen' as const
export const CLASSIC_GLASS_FINAL_BLUR = 0.5

/** Exact filter graph from the approved legacy control strip. */
export const CLASSIC_GLASS_FILTER_SVG =
  `<filter id="${CLASSIC_GLASS_FILTER_ID}" color-interpolation-filters="sRGB" x="-12%" y="-28%" width="124%" height="156%">` +
  `<feImage id="${CLASSIC_GLASS_MAP_ID}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"></feImage>` +
  '<feDisplacementMap in="SourceGraphic" in2="map" scale="180" xChannelSelector="R" yChannelSelector="B" result="dispRed"></feDisplacementMap>' +
  '<feOffset in="dispRed" dx="-90" dy="0" result="dispRedShifted"></feOffset>' +
  '<feMerge result="dispRedAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispRedShifted"></feMergeNode></feMerge>' +
  '<feColorMatrix in="dispRedAligned" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"></feColorMatrix>' +
  '<feDisplacementMap in="SourceGraphic" in2="map" scale="170" xChannelSelector="R" yChannelSelector="B" result="dispGreen"></feDisplacementMap>' +
  '<feOffset in="dispGreen" dx="-90" dy="0" result="dispGreenShifted"></feOffset>' +
  '<feMerge result="dispGreenAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispGreenShifted"></feMergeNode></feMerge>' +
  '<feColorMatrix in="dispGreenAligned" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green"></feColorMatrix>' +
  '<feDisplacementMap in="SourceGraphic" in2="map" scale="160" xChannelSelector="R" yChannelSelector="B" result="dispBlue"></feDisplacementMap>' +
  '<feOffset in="dispBlue" dx="-90" dy="0" result="dispBlueShifted"></feOffset>' +
  '<feMerge result="dispBlueAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispBlueShifted"></feMergeNode></feMerge>' +
  '<feColorMatrix in="dispBlueAligned" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue"></feColorMatrix>' +
  '<feBlend in="red" in2="green" mode="screen" result="rg"></feBlend>' +
  '<feBlend in="rg" in2="blue" mode="screen" result="output"></feBlend>' +
  '<feGaussianBlur in="output" stdDeviation="0.5"></feGaussianBlur>' +
  '</filter>'

export const CLASSIC_GLASS_MAP_BORDER_WIDTH = 0.07
export const CLASSIC_GLASS_MAP_INNER_BLUR = 11
export const CLASSIC_GLASS_MAP_MIN_WIDTH = 240
export const CLASSIC_GLASS_MAP_MIN_HEIGHT = 48
export const CLASSIC_GLASS_MAP_MIN_RADIUS = 12
export const CLASSIC_GLASS_MAP_DEFAULT_WIDTH = 400
export const CLASSIC_GLASS_MAP_DEFAULT_HEIGHT = 92
export const CLASSIC_GLASS_MAP_DEFAULT_RADIUS = 50

function normalizeMapValue(value: number, fallback: number, minimum: number): number {
  const source = Number.isFinite(value) && value !== 0 ? value : fallback
  return Math.max(minimum, Math.round(source))
}

/**
 * Creates the approved RGB displacement map as raw SVG markup.
 * It is deterministic, side-effect free, and safe for callers to encode as a data URL.
 */
export function createClassicGlassDisplacementSvg(width: number, height: number, radius: number): string {
  const normalizedWidth = normalizeMapValue(
    width,
    CLASSIC_GLASS_MAP_DEFAULT_WIDTH,
    CLASSIC_GLASS_MAP_MIN_WIDTH,
  )
  const normalizedHeight = normalizeMapValue(
    height,
    CLASSIC_GLASS_MAP_DEFAULT_HEIGHT,
    CLASSIC_GLASS_MAP_MIN_HEIGHT,
  )
  const normalizedRadius = normalizeMapValue(
    radius,
    CLASSIC_GLASS_MAP_DEFAULT_RADIUS,
    CLASSIC_GLASS_MAP_MIN_RADIUS,
  )
  const edge = Math.min(normalizedWidth, normalizedHeight) * (CLASSIC_GLASS_MAP_BORDER_WIDTH * 0.5)
  const innerWidth = Math.max(1, normalizedWidth - edge * 2)
  const innerHeight = Math.max(1, normalizedHeight - edge * 2)

  return (
    `<svg viewBox="0 0 ${normalizedWidth} ${normalizedHeight}" xmlns="http://www.w3.org/2000/svg">` +
    '<defs>' +
    '<linearGradient id="glass-red" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/></linearGradient>' +
    '<linearGradient id="glass-blue" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/></linearGradient>' +
    '</defs>' +
    `<rect x="0" y="0" width="${normalizedWidth}" height="${normalizedHeight}" fill="black"/>` +
    `<rect x="0" y="0" width="${normalizedWidth}" height="${normalizedHeight}" rx="${normalizedRadius}" fill="url(#glass-red)"/>` +
    `<rect x="0" y="0" width="${normalizedWidth}" height="${normalizedHeight}" rx="${normalizedRadius}" fill="url(#glass-blue)" style="mix-blend-mode:difference"/>` +
    `<rect x="${edge.toFixed(2)}" y="${edge.toFixed(2)}" width="${innerWidth.toFixed(2)}" height="${innerHeight.toFixed(2)}" rx="${normalizedRadius}" fill="hsl(0 0% 50% / 1)" style="filter:blur(${CLASSIC_GLASS_MAP_INNER_BLUR}px)"/>` +
    '</svg>'
  )
}

import { describe, expect, it } from 'vitest'
import {
  CLASSIC_GLASS_BLEND_MODE,
  CLASSIC_GLASS_CHROMATIC_OFFSET,
  CLASSIC_GLASS_CSS_VARIABLES,
  CLASSIC_GLASS_DISPLACEMENT_SCALES,
  CLASSIC_GLASS_FILTER_ID,
  CLASSIC_GLASS_FILTER_REGION,
  CLASSIC_GLASS_FILTER_SVG,
  CLASSIC_GLASS_FINAL_BLUR,
  CLASSIC_GLASS_MAP_BORDER_WIDTH,
  CLASSIC_GLASS_MAP_INNER_BLUR,
  CLASSIC_GLASS_MAP_MIN_HEIGHT,
  CLASSIC_GLASS_MAP_MIN_RADIUS,
  CLASSIC_GLASS_MAP_MIN_WIDTH,
  CLASSIC_GOLD_THEME,
  createClassicGlassDisplacementSvg,
  type ClassicThemePreset,
} from '@renderer/theme/classic'

describe('classic gold theme', () => {
  it('stays structurally compatible with the standalone classic preset contract', () => {
    const preset: ClassicThemePreset = CLASSIC_GOLD_THEME

    expect(preset.id).toBe('classic-gold')
    expect(preset.label).toBe('经典')
    expect(preset.visualParams).toEqual({
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
    })
    expect(Object.isFrozen(preset)).toBe(true)
    expect(Object.isFrozen(preset.visualParams)).toBe(true)
  })

  it('locks the complete approved panel and button CSS values', () => {
    expect(CLASSIC_GLASS_CSS_VARIABLES).toEqual({
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
    })
    expect(Object.keys(CLASSIC_GLASS_CSS_VARIABLES)).not.toContain('--saved-panel-glass-svg-filter')
    expect(Object.keys(CLASSIC_GLASS_CSS_VARIABLES)).not.toContain('--saved-button-glass-svg-filter')
  })
})

describe('classic control-strip SVG filter', () => {
  it('locks the golden filter constants', () => {
    expect(CLASSIC_GLASS_FILTER_ID).toBe('mineradio-control-glass-filter')
    expect(CLASSIC_GLASS_FILTER_REGION).toEqual({
      x: '-12%',
      y: '-28%',
      width: '124%',
      height: '156%',
    })
    expect(CLASSIC_GLASS_DISPLACEMENT_SCALES).toEqual({ red: 180, green: 170, blue: 160 })
    expect(CLASSIC_GLASS_CHROMATIC_OFFSET).toEqual({ dx: -90, dy: 0 })
    expect(CLASSIC_GLASS_BLEND_MODE).toBe('screen')
    expect(CLASSIC_GLASS_FINAL_BLUR).toBe(0.5)
  })

  it('preserves the three-channel displacement, alignment, screen merge, and final blur graph', () => {
    expect(CLASSIC_GLASS_FILTER_SVG).toBe(
      '<filter id="mineradio-control-glass-filter" color-interpolation-filters="sRGB" x="-12%" y="-28%" width="124%" height="156%">' +
        '<feImage id="control-glass-map" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"></feImage>' +
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
        '</filter>',
    )
  })
})

describe('classic displacement map generator', () => {
  it('locks map geometry constants and clamps dimensions and radius to golden minimums', () => {
    expect(CLASSIC_GLASS_MAP_BORDER_WIDTH).toBe(0.07)
    expect(CLASSIC_GLASS_MAP_INNER_BLUR).toBe(11)
    expect(CLASSIC_GLASS_MAP_MIN_WIDTH).toBe(240)
    expect(CLASSIC_GLASS_MAP_MIN_HEIGHT).toBe(48)
    expect(CLASSIC_GLASS_MAP_MIN_RADIUS).toBe(12)

    expect(createClassicGlassDisplacementSvg(120.4, 20.4, 4.4)).toBe(
      '<svg viewBox="0 0 240 48" xmlns="http://www.w3.org/2000/svg">' +
        '<defs>' +
        '<linearGradient id="glass-red" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/></linearGradient>' +
        '<linearGradient id="glass-blue" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/></linearGradient>' +
        '</defs>' +
        '<rect x="0" y="0" width="240" height="48" fill="black"/>' +
        '<rect x="0" y="0" width="240" height="48" rx="12" fill="url(#glass-red)"/>' +
        '<rect x="0" y="0" width="240" height="48" rx="12" fill="url(#glass-blue)" style="mix-blend-mode:difference"/>' +
        '<rect x="1.68" y="1.68" width="236.64" height="44.64" rx="12" fill="hsl(0 0% 50% / 1)" style="filter:blur(11px)"/>' +
        '</svg>',
    )
  })

  it('uses legacy defaults for zero values and rounds finite dimensions deterministically', () => {
    const defaults = createClassicGlassDisplacementSvg(0, 0, 0)
    expect(defaults).toContain('viewBox="0 0 400 92"')
    expect(defaults).toContain('width="400" height="92" rx="50"')
    expect(defaults).toContain('<rect x="3.22" y="3.22" width="393.56" height="85.56" rx="50"')

    const rounded = createClassicGlassDisplacementSvg(640.6, 80.4, 25.6)
    expect(rounded).toContain('viewBox="0 0 641 80"')
    expect(rounded).toContain('width="641" height="80" rx="26"')
    expect(rounded).toContain('<rect x="2.80" y="2.80" width="635.40" height="74.40" rx="26"')
    expect(createClassicGlassDisplacementSvg(640.6, 80.4, 25.6)).toBe(rounded)
  })
})

import { describe, expect, it } from 'vitest'
import { CLASSIC_GOLD_THEME, DEFAULT_ACCENT_COLOR } from '@renderer/theme/classic'

describe('classic gold theme', () => {
  it('owns colors and typography without duplicating global glass state', () => {
    expect(CLASSIC_GOLD_THEME.visualParams).toEqual({
      background: '#000000',
      text: '#ffffff',
      textMuted: '#8a9099',
      accent: DEFAULT_ACCENT_COLOR,
      danger: '#d95b67',
      panelSurface: '#000000',
      panelBorder: '#ffffff',
      fontFamily:
        "'Noto Sans SC', 'PingFang SC', 'HarmonyOS Sans SC', 'Alibaba PuHuiTi', Inter, system-ui, sans-serif",
      fontScale: 1,
    })
    expect(CLASSIC_GOLD_THEME.visualParams).not.toHaveProperty('blur')
    expect(CLASSIC_GOLD_THEME.visualParams).not.toHaveProperty('distortion')
    expect(Object.isFrozen(CLASSIC_GOLD_THEME)).toBe(true)
    expect(Object.isFrozen(CLASSIC_GOLD_THEME.visualParams)).toBe(true)
  })
})

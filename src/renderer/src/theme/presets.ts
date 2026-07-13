import type { ThemePreset, ThemePresetId, ThemeVisualParams } from './types'
import { CLASSIC_GOLD_THEME } from './classic'

export const DEFAULT_THEME_PRESET_ID: ThemePresetId = 'default-dark'

const SYSTEM_FONT = "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif"
const REFINED_FONT = "Inter, 'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif"

function definePreset(preset: ThemePreset): ThemePreset {
  Object.freeze(preset.visualParams)
  return Object.freeze(preset)
}

export const THEME_PRESETS: Readonly<Record<ThemePresetId, ThemePreset>> = Object.freeze({
  'default-dark': definePreset({
    id: 'default-dark',
    label: '默认暗色',
    description: '平衡通透度与性能的默认暗色玻璃。',
    visualParams: {
      background: '#07080c',
      text: 'rgba(255, 255, 255, 0.88)',
      textMuted: 'rgba(255, 255, 255, 0.45)',
      accent: '#7c8cff',
      danger: '#ff6a7a',
      panelSurface: '#14161e',
      panelBorder: '#ffffff',
      blur: 18,
      saturation: 120,
      backgroundOpacity: 0.72,
      borderOpacity: 0.08,
      distortion: 0,
      chromaticAberration: 0,
      radius: 14,
      fontFamily: SYSTEM_FONT,
      fontScale: 1,
    },
  }),
  'dense-fog': definePreset({
    id: 'dense-fog',
    label: '浓雾玻璃',
    description: '高模糊与更高面板密度，适合沉浸式暗色界面。',
    visualParams: {
      background: '#000000',
      text: 'rgba(255, 255, 255, 0.92)',
      textMuted: 'rgba(255, 255, 255, 0.5)',
      accent: '#8d98ff',
      danger: '#ff6678',
      panelSurface: '#090a0e',
      panelBorder: '#ffffff',
      blur: 30,
      saturation: 105,
      backgroundOpacity: 0.86,
      borderOpacity: 0.1,
      distortion: 0,
      chromaticAberration: 0,
      radius: 12,
      fontFamily: SYSTEM_FONT,
      fontScale: 1,
    },
  }),
  'clear-glass': definePreset({
    id: 'clear-glass',
    label: '清透玻璃',
    description: '低模糊、低面板密度，强调层次和内容可见度。',
    visualParams: {
      background: '#080a10',
      text: 'rgba(248, 250, 255, 0.9)',
      textMuted: 'rgba(220, 228, 245, 0.5)',
      accent: '#87a7ff',
      danger: '#ff756f',
      panelSurface: '#141925',
      panelBorder: '#e7edff',
      blur: 10,
      saturation: 108,
      backgroundOpacity: 0.48,
      borderOpacity: 0.1,
      distortion: 0,
      chromaticAberration: 0,
      radius: 16,
      fontFamily: SYSTEM_FONT,
      fontScale: 1,
    },
  }),
  'liquid-glass': definePreset({
    id: 'liquid-glass',
    label: '液态玻璃',
    description: '仅为紧凑卡片启用克制的扭曲与色散，大面积表面仍走纯 CSS。',
    visualParams: {
      background: '#0a0b10',
      text: 'rgba(248, 249, 255, 0.92)',
      textMuted: 'rgba(224, 227, 241, 0.52)',
      accent: '#a08cff',
      danger: '#ff7187',
      panelSurface: '#171822',
      panelBorder: '#f4f1ff',
      blur: 24,
      saturation: 116,
      backgroundOpacity: 0.68,
      borderOpacity: 0.12,
      distortion: 4,
      chromaticAberration: 1,
      radius: 18,
      fontFamily: REFINED_FONT,
      fontScale: 1,
    },
  }),
  'soft-white': definePreset({
    id: 'soft-white',
    label: '皓白',
    description: '明亮克制的白色玻璃界面，保持清晰层次与柔和对比。',
    visualParams: {
      background: '#eef1f6',
      text: 'rgba(20, 24, 32, 0.92)',
      textMuted: 'rgba(40, 48, 62, 0.58)',
      accent: '#526ee8',
      danger: '#d9475d',
      panelSurface: '#ffffff',
      panelBorder: '#657087',
      blur: 20,
      saturation: 105,
      backgroundOpacity: 0.84,
      borderOpacity: 0.16,
      distortion: 0,
      chromaticAberration: 0,
      radius: 14,
      fontFamily: REFINED_FONT,
      fontScale: 1,
    },
  }),
  'classic-gold': definePreset(CLASSIC_GOLD_THEME),
})

export const THEME_PRESET_LIST: readonly ThemePreset[] = Object.freeze(Object.values(THEME_PRESETS))

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(THEME_PRESETS, value)
}

export function getThemePreset(id: ThemePresetId): ThemePreset {
  return THEME_PRESETS[id]
}

export function cloneThemeVisualParams(params: Readonly<ThemeVisualParams>): ThemeVisualParams {
  return { ...params }
}

export function snapshotFromPreset(id: ThemePresetId = DEFAULT_THEME_PRESET_ID): {
  selectedPresetId: ThemePresetId
  visualParams: ThemeVisualParams
} {
  return {
    selectedPresetId: id,
    visualParams: cloneThemeVisualParams(THEME_PRESETS[id].visualParams),
  }
}

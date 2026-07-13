import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_PRESET_ID,
  THEME_CSS_VARIABLE_NAMES,
  THEME_PERSISTENCE_KEY,
  THEME_PERSISTENCE_VERSION,
  THEME_PRESETS,
  THEME_PRESET_LIST,
  createThemeStore,
  deserializePersistedTheme,
  isThemeVisualParams,
  type ThemeStorage,
  type ThemeStyleTarget,
} from '@renderer/theme'

class MemoryThemeStorage implements ThemeStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

class MemoryStyle implements ThemeStyleTarget {
  readonly values = new Map<string, string>()

  setProperty(name: string, value: string): void {
    this.values.set(name, value)
  }
}

describe('theme presets', () => {
  it('ships all complete CSS theme presets including classic gold', () => {
    expect(THEME_PRESET_LIST.map((preset) => preset.id)).toEqual([
      'default-dark',
      'dense-fog',
      'clear-glass',
      'liquid-glass',
      'soft-white',
      'classic-gold',
    ])

    for (const preset of THEME_PRESET_LIST) {
      expect(isThemeVisualParams(preset.visualParams), preset.id).toBe(true)
      expect(Object.keys(preset.visualParams).sort()).toEqual([
        'accent',
        'background',
        'backgroundOpacity',
        'blur',
        'borderOpacity',
        'chromaticAberration',
        'danger',
        'distortion',
        'fontFamily',
        'fontScale',
        'panelBorder',
        'panelSurface',
        'radius',
        'saturation',
        'text',
        'textMuted',
      ])
    }
  })

  it('ships a complete light preset and applies light native controls', () => {
    const style = new MemoryStyle()
    const store = createThemeStore({ storage: null, styleTarget: style })

    store.getState().selectPreset('soft-white')

    expect(THEME_PRESETS['soft-white'].visualParams.background).toBe('#eef1f6')
    expect(THEME_PRESETS['soft-white'].visualParams.text).toContain('20, 24, 32')
    expect(style.values.get('--flux-color-scheme')).toBe('light')
    expect(style.values.get('--flux-bg')).toBe('#eef1f6')
  })

  it('has one CSS variable for every visual parameter', () => {
    expect(Object.keys(THEME_CSS_VARIABLE_NAMES).sort()).toEqual(
      Object.keys(THEME_PRESETS[DEFAULT_THEME_PRESET_ID].visualParams).sort(),
    )
    expect(new Set(Object.values(THEME_CSS_VARIABLE_NAMES)).size).toBe(
      Object.keys(THEME_CSS_VARIABLE_NAMES).length,
    )
  })
})

describe('versioned theme persistence', () => {
  it('rejects malformed JSON, old versions, and incomplete visual values', () => {
    expect(deserializePersistedTheme('{not-json')).toBeNull()
    expect(
      deserializePersistedTheme(
        JSON.stringify({
          version: THEME_PERSISTENCE_VERSION + 1,
          selectedPresetId: 'dense-fog',
          visualParams: THEME_PRESETS['dense-fog'].visualParams,
        }),
      ),
    ).toBeNull()
    expect(
      deserializePersistedTheme(
        JSON.stringify({
          version: THEME_PERSISTENCE_VERSION,
          selectedPresetId: 'dense-fog',
          visualParams: { background: '#000000' },
        }),
      ),
    ).toBeNull()
  })

  it('falls back safely when persisted data is corrupt', () => {
    const storage = new MemoryThemeStorage()
    const style = new MemoryStyle()
    storage.setItem(THEME_PERSISTENCE_KEY, '{broken')

    const store = createThemeStore({ storage, styleTarget: style })

    expect(store.getState().selectedPresetId).toBe(DEFAULT_THEME_PRESET_ID)
    expect(store.getState().visualParams).toEqual(THEME_PRESETS[DEFAULT_THEME_PRESET_ID].visualParams)
    expect(style.values.get('--flux-bg')).toBe(THEME_PRESETS[DEFAULT_THEME_PRESET_ID].visualParams.background)
  })

  it('is safe when DOM and localStorage are intentionally unavailable', () => {
    expect(() => createThemeStore({ storage: null, styleTarget: null })).not.toThrow()
  })
})

describe('theme store live application', () => {
  it('applies a complete variable set after selecting and patching', () => {
    const storage = new MemoryThemeStorage()
    const style = new MemoryStyle()
    const store = createThemeStore({ storage, styleTarget: style })

    store.getState().selectPreset('clear-glass')
    expect(style.values.get('--flux-bg')).toBe(THEME_PRESETS['clear-glass'].visualParams.background)
    expect(style.values.get('--flux-glass-blur')).toBe('10px')
    expect(store.getState().customized).toBe(false)

    store.getState().patchVisualParams({
      accent: '#ffcc66',
      blur: 31,
      saturation: 143,
      radius: 19,
      fontScale: 1.08,
    })

    expect(style.values.get('--flux-accent')).toBe('#ffcc66')
    expect(style.values.get('--flux-glass-blur')).toBe('31px')
    expect(style.values.get('--flux-glass-saturation')).toBe('143%')
    expect(style.values.get('--flux-glass-radius')).toBe('19px')
    expect(style.values.get('--flux-font-scale')).toBe('1.08')
    expect(style.values.size).toBe(Object.keys(THEME_CSS_VARIABLE_NAMES).length + 1)
    expect(style.values.get('--flux-color-scheme')).toBe('dark')
    expect(store.getState().customized).toBe(true)
  })

  it('restores the selected preset and custom values in a fresh store', () => {
    const storage = new MemoryThemeStorage()
    const firstStyle = new MemoryStyle()
    const first = createThemeStore({ storage, styleTarget: firstStyle })

    first.getState().selectPreset('liquid-glass')
    first.getState().patchVisualParams({ blur: 29, accent: '#90e0ff', distortion: 7 })

    const refreshedStyle = new MemoryStyle()
    const refreshed = createThemeStore({ storage, styleTarget: refreshedStyle })

    expect(refreshed.getState()).toMatchObject({
      selectedPresetId: 'liquid-glass',
      customized: true,
      hydrated: true,
      visualParams: {
        blur: 29,
        accent: '#90e0ff',
        distortion: 7,
      },
    })
    expect(refreshedStyle.values.get('--flux-glass-blur')).toBe('29px')
    expect(refreshedStyle.values.get('--flux-accent')).toBe('#90e0ff')
    expect(refreshedStyle.values.get('--flux-glass-distortion')).toBe('7')
  })
})

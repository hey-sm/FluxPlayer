import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_PRESET_ID,
  THEME_CSS_VARIABLE_NAMES,
  THEME_PERSISTENCE_KEY,
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

describe('classic-only theme', () => {
  it('ships classic gold as the sole preset and default', () => {
    expect(DEFAULT_THEME_PRESET_ID).toBe('classic-gold')
    expect(THEME_PRESET_LIST.map((preset) => preset.id)).toEqual(['classic-gold'])
    expect(Object.keys(THEME_PRESETS)).toEqual(['classic-gold'])
    expect(isThemeVisualParams(THEME_PRESETS['classic-gold'].visualParams)).toBe(true)
    expect(Object.keys(THEME_CSS_VARIABLE_NAMES).sort()).toEqual(
      Object.keys(THEME_PRESETS['classic-gold'].visualParams).sort(),
    )
  })

  it('migrates old preset and customized V1 snapshots to classic defaults', () => {
    const migrated = deserializePersistedTheme(
      JSON.stringify({
        version: 1,
        selectedPresetId: 'soft-white',
        visualParams: { accent: '#ff0000', blur: 40 },
      }),
    )
    expect(migrated).toEqual({
      selectedPresetId: 'classic-gold',
      visualParams: { ...THEME_PRESETS['classic-gold'].visualParams },
      lyricsColor: THEME_PRESETS['classic-gold'].visualParams.accent,
      lyricsColorLinked: true,
    })
  })

  it('rejects malformed JSON and unknown persistence versions', () => {
    expect(deserializePersistedTheme('{not-json')).toBeNull()
    expect(deserializePersistedTheme(JSON.stringify({ version: 4 }))).toBeNull()
  })

  it('migrates V2 colors and typography while ignoring its glass values', () => {
    const current = THEME_PRESETS['classic-gold'].visualParams
    const migrated = deserializePersistedTheme(
      JSON.stringify({
        version: 2,
        selectedPresetId: 'classic-gold',
        visualParams: {
          ...current,
          accent: '#334455',
          fontScale: 1.2,
          blur: 39,
          distortion: 99,
        },
        lyricsColor: '#778899',
        lyricsColorLinked: false,
      }),
    )
    expect(migrated).toMatchObject({
      visualParams: { accent: '#334455', fontScale: 1.2 },
      lyricsColor: '#778899',
      lyricsColorLinked: false,
    })
    expect(migrated?.visualParams).not.toHaveProperty('blur')
    expect(migrated?.visualParams).not.toHaveProperty('distortion')
  })

  it('applies classic variables and rewrites persisted state on startup', () => {
    const storage = new MemoryThemeStorage()
    const style = new MemoryStyle()
    storage.setItem(
      THEME_PERSISTENCE_KEY,
      JSON.stringify({
        version: 1,
        selectedPresetId: 'dense-fog',
        visualParams: { blur: 30 },
      }),
    )
    const store = createThemeStore({ storage, styleTarget: style })
    expect(store.getState()).toMatchObject({ selectedPresetId: 'classic-gold', hydrated: true })
    expect(style.values.get('--flux-bg')).toBe(THEME_PRESETS['classic-gold'].visualParams.background)
    expect(JSON.parse(storage.getItem(THEME_PERSISTENCE_KEY)!)).toEqual({
      version: 3,
      selectedPresetId: 'classic-gold',
      visualParams: THEME_PRESETS['classic-gold'].visualParams,
      lyricsColor: THEME_PRESETS['classic-gold'].visualParams.accent,
      lyricsColorLinked: true,
    })
  })

  it('persists the accent and lets lyric color follow or diverge', () => {
    const storage = new MemoryThemeStorage()
    const style = new MemoryStyle()
    const store = createThemeStore({ storage, styleTarget: style })

    store.getState().setAccent('#3B82F6')
    expect(store.getState().visualParams.accent).toBe('#3b82f6')
    expect(store.getState().lyricsColor).toBe('#3b82f6')
    expect(style.values.get('--flux-accent')).toBe('#3b82f6')

    store.getState().setLyricsColorLinked(false)
    store.getState().setLyricsColor('#f43f5e')
    store.getState().setAccent('#22c55e')
    expect(store.getState()).toMatchObject({
      lyricsColor: '#f43f5e',
      lyricsColorLinked: false,
      visualParams: { accent: '#22c55e' },
    })

    const restored = createThemeStore({ storage, styleTarget: new MemoryStyle() })
    expect(restored.getState()).toMatchObject({
      lyricsColor: '#f43f5e',
      lyricsColorLinked: false,
      visualParams: { accent: '#22c55e' },
    })
  })

  it('is safe without DOM and localStorage', () => {
    expect(() => createThemeStore({ storage: null, styleTarget: null })).not.toThrow()
  })
})

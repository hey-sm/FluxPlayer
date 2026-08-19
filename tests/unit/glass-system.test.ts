import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GLASS_CONFIG,
  glassConfigToCssVariables,
  glassConfigToSurfaceCssVariables,
  normalizeGlassColor,
  normalizeGlassConfig,
  patchGlassConfig,
  resolveGlassSurfaceConfig,
} from '@renderer/components/glass/config'
import {
  GLASS_PERSISTENCE_KEY,
  deserializeGlassConfig,
  serializeGlassConfig,
  type GlassStorage,
} from '@renderer/components/glass/persistence'
import { createGlassStore, type GlassStyleTarget } from '@renderer/components/glass/store'

class MemoryStorage implements GlassStorage {
  readonly values = new Map<string, string>()
  writes = 0
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.writes += 1
    this.values.set(key, value)
  }
}

class MemoryStyle implements GlassStyleTarget {
  readonly values = new Map<string, string>()
  setProperty(name: string, value: string): void {
    this.values.set(name, value)
  }
}

describe('global liquid glass config', () => {
  it('locks the complete approved default and interaction values', () => {
    expect(DEFAULT_GLASS_CONFIG).toEqual({
      blur: 10,
      distortion: 50,
      flexibility: 0,
      borderColor: '#ffffff',
      borderSize: 1,
      borderRadius: 20,
      borderOpacity: 0,
      backgroundColor: '#000000ff',
      backgroundOpacity: 0,
      innerLightColor: '#ffffff',
      innerLightSpread: 0,
      innerLightBlur: 8,
      innerLightOpacity: 0.3,
      outerLightColor: '#ffffff',
      outerLightSpread: 0,
      outerLightBlur: 0,
      outerLightOpacity: 0,
      color: '#ffffff',
      chromaticAberration: 0,
      onHoverScale: 1,
      saturation: 100,
      brightness: 100,
    })
    expect(patchGlassConfig(DEFAULT_GLASS_CONFIG, { flexibility: 99, onHoverScale: 3 })).toMatchObject({
      flexibility: 0,
      onHoverScale: 1,
    })
  })

  it('accepts six/eight-digit colors and normalizes corrupt fields independently', () => {
    expect(normalizeGlassColor(' #AABBCCDD ')).toBe('#aabbccdd')
    expect(normalizeGlassColor('#abc')).toBeNull()
    expect(
      normalizeGlassConfig({
        blur: 12,
        distortion: 101,
        borderColor: '#ABCDEF',
        backgroundColor: 'black',
        flexibility: 42,
        onHoverScale: 4,
      }),
    ).toMatchObject({
      blur: 12,
      distortion: DEFAULT_GLASS_CONFIG.distortion,
      borderColor: '#abcdef',
      backgroundColor: DEFAULT_GLASS_CONFIG.backgroundColor,
      flexibility: 0,
      onHoverScale: 1,
    })
  })

  it('uses a versioned envelope and survives partial persisted damage', () => {
    expect(deserializeGlassConfig('{bad-json')).toBeNull()
    expect(deserializeGlassConfig(JSON.stringify({ version: 4, config: {} }))).toBeNull()
    const restored = deserializeGlassConfig(
      JSON.stringify({ version: 3, config: { blur: 19, borderOpacity: -2, color: '#11223344' } }),
    )
    expect(restored).toMatchObject({
      blur: 19,
      borderOpacity: DEFAULT_GLASS_CONFIG.borderOpacity,
      color: '#11223344',
    })
    expect(JSON.parse(serializeGlassConfig(restored!))).toMatchObject({ version: 3, config: restored })
  })

  it('migrates the untouched V2 defaults while preserving customized V2 values', () => {
    const previousDefaults = {
      ...DEFAULT_GLASS_CONFIG,
      distortion: 40,
      borderRadius: 30,
      innerLightSpread: 1,
      innerLightBlur: 10,
      innerLightOpacity: 0,
      outerLightSpread: 1,
      outerLightBlur: 10,
    }

    expect(deserializeGlassConfig(JSON.stringify({ version: 2, config: previousDefaults }))).toEqual(
      DEFAULT_GLASS_CONFIG,
    )
    expect(
      deserializeGlassConfig(
        JSON.stringify({ version: 2, config: { ...previousDefaults, brightness: 124 } }),
      ),
    ).toMatchObject({ brightness: 124, distortion: 40, borderRadius: 30 })
  })

  it('migrates legacy defaults to the new global blur and border opacity', () => {
    const restored = deserializeGlassConfig(
      JSON.stringify({
        version: 1,
        config: { blur: 3, borderOpacity: 0.4, distortion: 72, color: '#11223344' },
      }),
    )

    expect(restored).toMatchObject({
      blur: 10,
      borderOpacity: 0,
      distortion: 72,
      color: '#11223344',
    })
  })

  it('exports every lightweight CSS variable from the same config', () => {
    expect(glassConfigToCssVariables(DEFAULT_GLASS_CONFIG)).toMatchObject({
      '--flux-glass-blur': '10px',
      '--flux-glass-distortion': '50',
      '--flux-glass-background-color': '#000000ff',
      '--flux-glass-radius': '20px',
      '--flux-glass-saturation': '100%',
      '--flux-glass-brightness': '100%',
      '--flux-glass-border-opacity': '0',
    })
  })

  it('keeps local Surface overrides scoped and derives their aliases locally', () => {
    const local = resolveGlassSurfaceConfig(DEFAULT_GLASS_CONFIG, { borderRadius: 999, blur: 24 })
    const variables = glassConfigToSurfaceCssVariables(local)

    expect(local).toMatchObject({ borderRadius: 999, blur: 24 })
    expect(DEFAULT_GLASS_CONFIG).toMatchObject({ borderRadius: 20, blur: 10 })
    expect(variables).toMatchObject({
      '--flux-glass-radius': '999px',
      '--flux-glass-blur': '24px',
      '--flux-glass-background': expect.stringContaining('#000000ff'),
      '--flux-glass-border': expect.stringContaining('#ffffff'),
      '--flux-radius-shell': '999px',
      '--flux-text': '#ffffff',
    })
    expect(glassConfigToCssVariables(DEFAULT_GLASS_CONFIG)).not.toHaveProperty('--flux-glass-background')
  })
})

describe('global liquid glass store', () => {
  it('coalesces previews to one update per frame and commits storage once', () => {
    const storage = new MemoryStorage()
    const style = new MemoryStyle()
    const frames: FrameRequestCallback[] = []
    const store = createGlassStore({
      storage,
      styleTarget: style,
      autoRestore: false,
      requestFrame: (callback) => {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: () => undefined,
    })

    store.getState().previewConfig({ blur: 8 })
    store.getState().previewConfig({ blur: 11, distortion: 70 })
    expect(frames).toHaveLength(1)
    expect(store.getState().config.blur).toBe(10)
    frames[0](0)
    expect(store.getState().config).toMatchObject({ blur: 11, distortion: 70 })
    expect(style.values.get('--flux-glass-blur')).toBe('11px')
    expect(storage.writes).toBe(0)

    store.getState().commitConfig({ brightness: 120 })
    expect(storage.writes).toBe(1)
    expect(JSON.parse(storage.values.get(GLASS_PERSISTENCE_KEY)!)).toMatchObject({
      version: 3,
      config: { blur: 11, distortion: 70, brightness: 120 },
    })
  })

  it('flushes a pending preview synchronously and resets to defaults', () => {
    const storage = new MemoryStorage()
    let scheduled: FrameRequestCallback | null = null
    const store = createGlassStore({
      storage,
      styleTarget: null,
      autoRestore: false,
      requestFrame: (callback) => {
        scheduled = callback
        return 7
      },
      cancelFrame: () => {
        scheduled = null
      },
    })

    store.getState().previewConfig({ borderRadius: 48 })
    store.getState().commitConfig()
    expect(scheduled).toBeNull()
    expect(store.getState().config.borderRadius).toBe(48)
    expect(storage.writes).toBe(1)

    store.getState().resetConfig()
    expect(store.getState().config).toEqual(DEFAULT_GLASS_CONFIG)
    expect(storage.writes).toBe(2)
  })

  it('upgrades legacy storage when the global store starts', () => {
    const storage = new MemoryStorage()
    storage.values.set(
      GLASS_PERSISTENCE_KEY,
      JSON.stringify({ version: 1, config: { blur: 3, borderOpacity: 0.4, distortion: 64 } }),
    )
    const store = createGlassStore({ storage, styleTarget: null })

    expect(store.getState().config).toMatchObject({ blur: 10, borderOpacity: 0, distortion: 64 })
    expect(JSON.parse(storage.values.get(GLASS_PERSISTENCE_KEY)!)).toMatchObject({
      version: 3,
      config: { blur: 10, borderOpacity: 0, distortion: 64 },
    })
  })
})

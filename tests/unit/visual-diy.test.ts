import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_VISUAL_PARAMS, type VisualParams } from '@renderer/visual/bus'
import {
  DEFAULT_DIY_VISUAL_PARAMS,
  DIY_VISUAL_PARAM_KEYS,
  DIY_VISUAL_PARAM_SCHEMA,
  DIY_VISUAL_PARAMS_PERSISTENCE_KEY,
  createDiyVisualParamsController,
  createVisualBusDiyParamsAdapter,
  deserializeDiyVisualParams,
  type DiyVisualParamsStorage,
} from '@renderer/visual/diy'

class MemoryStorage implements DiyVisualParamsStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function busAdapterSpy() {
  const bus = { setParams: vi.fn<(params: Partial<VisualParams>) => void>() }
  return { bus, adapter: createVisualBusDiyParamsAdapter(bus) }
}

describe('DIY visual parameter schema', () => {
  it('covers exactly the current VisualBus params and excludes theme tokens', () => {
    expect([...DIY_VISUAL_PARAM_KEYS].sort()).toEqual(Object.keys(DEFAULT_VISUAL_PARAMS).sort())
    expect(Object.fromEntries(DIY_VISUAL_PARAM_KEYS.map((key) => [key, DIY_VISUAL_PARAM_SCHEMA[key].default]))).toEqual(
      DEFAULT_VISUAL_PARAMS,
    )
    expect(DIY_VISUAL_PARAM_KEYS).not.toContain('accentColor')
    expect(DIY_VISUAL_PARAM_KEYS).not.toContain('background')
  })

  it('survives bad JSON, clamps bounds, migrates aliases, and drops unknown fields', () => {
    expect(deserializeDiyVisualParams('{broken')).toEqual(DEFAULT_DIY_VISUAL_PARAMS)

    const parsed = deserializeDiyVisualParams(
      JSON.stringify({
        version: 0,
        values: {
          intensity: 999,
          depth: -20,
          point: '1.75',
          color: 1.4,
          bgFade: 0.7,
          speed: 'not-a-number',
          accentColor: '#ff0000',
          arbitrary: 42,
        },
      }),
    )

    expect(parsed).toMatchObject({
      intensity: 1.6,
      depth: 0.2,
      pointScale: 1.75,
      colorBoost: 1.4,
      backgroundFade: 0.7,
      speed: DEFAULT_DIY_VISUAL_PARAMS.speed,
    })
    expect(Object.keys(parsed).sort()).toEqual([...DIY_VISUAL_PARAM_KEYS].sort())
    expect(parsed).not.toHaveProperty('accentColor')
    expect(parsed).not.toHaveProperty('arbitrary')
  })
})

describe('DIY visual persistence and controller', () => {
  it('restores persisted values in a fresh controller', () => {
    const storage = new MemoryStorage()
    const firstPort = busAdapterSpy()
    const first = createDiyVisualParamsController({ storage, adapter: firstPort.adapter })

    first.setParams({ speed: 2.2, scatter: 0.31 })

    const secondPort = busAdapterSpy()
    const refreshed = createDiyVisualParamsController({ storage, adapter: secondPort.adapter })
    expect(refreshed.getSnapshot()).toMatchObject({ speed: 2.2, scatter: 0.31 })
    expect(secondPort.bus.setParams).toHaveBeenLastCalledWith(
      expect.objectContaining({ speed: 2.2, scatter: 0.31 }),
    )
  })

  it('resets runtime and persisted state to canonical defaults', () => {
    const storage = new MemoryStorage()
    const port = busAdapterSpy()
    const controller = createDiyVisualParamsController({ storage, adapter: port.adapter })
    controller.setParam('twist', 0.5)

    expect(controller.reset()).toEqual(DEFAULT_DIY_VISUAL_PARAMS)
    expect(port.bus.setParams).toHaveBeenLastCalledWith(DEFAULT_DIY_VISUAL_PARAMS)

    const persisted = storage.getItem(DIY_VISUAL_PARAMS_PERSISTENCE_KEY)
    expect(deserializeDiyVisualParams(persisted)).toEqual(DEFAULT_DIY_VISUAL_PARAMS)
  })

  it('publishes synchronous updates and routes every effective write through the bus adapter', () => {
    const port = busAdapterSpy()
    const controller = createDiyVisualParamsController({ storage: null, adapter: port.adapter })
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    const writesAfterHydration = port.bus.setParams.mock.calls.length

    controller.setParam('bloomStrength', 99)
    expect(controller.getSnapshot().bloomStrength).toBe(1.6)
    expect(port.bus.setParams).toHaveBeenCalledTimes(writesAfterHydration + 1)
    expect(port.bus.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ bloomStrength: 1.6 }))
    expect(listener).toHaveBeenCalledOnce()

    controller.setParams({ unknown: 123 } as unknown)
    expect(port.bus.setParams).toHaveBeenCalledTimes(writesAfterHydration + 1)

    unsubscribe()
    unsubscribe()
    controller.setParam('alpha', 0.5)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('is safe when localStorage is unavailable', () => {
    const port = busAdapterSpy()
    expect(() => createDiyVisualParamsController({ storage: null, adapter: port.adapter })).not.toThrow()
  })
})

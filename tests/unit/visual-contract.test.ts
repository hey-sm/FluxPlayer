import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_VISUAL_PARAMS, VisualBus, type AnalyserFrame } from '@renderer/visual/bus'
import { ResourceRegistry } from '@renderer/visual/resources'
import { bloomFs, bloomVs, fs, vs } from '@renderer/visual/shaders'
import { VISUAL_PRESETS } from '@renderer/visual/presets/registry'

function legacyTemplate(source: string, variable: string): string {
  const marker = `var ${variable} = \``
  const start = source.indexOf(marker)
  if (start < 0) throw new Error(`legacy shader ${variable} not found`)
  const contentStart = start + marker.length
  const end = source.indexOf('`;', contentStart)
  if (end < 0) throw new Error(`legacy shader ${variable} is unterminated`)
  return source.slice(contentStart, end)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('M4 visual contracts', () => {
  it('keeps shader strings byte-identical to the legacy authoritative source', () => {
    const legacy = readFileSync(resolve(process.cwd(), '..', 'public', 'index.html'), 'utf8')
    const legacyVs = legacyTemplate(legacy, 'vs')
    const legacyFs = legacyTemplate(legacy, 'fs')
    const legacyBloomFs = legacyTemplate(legacy, 'bloomFs')

    expect(sha256(vs)).toBe(sha256(legacyVs))
    expect(sha256(fs)).toBe(sha256(legacyFs))
    expect(sha256(bloomFs)).toBe(sha256(legacyBloomFs))
    expect(bloomVs).toBe(
      legacyVs
        .replace(
          'uniform float uMouseActive, uPixel, uColorMixT, uLoading;',
          'uniform float uMouseActive, uPixel, uColorMixT, uLoading, uBloomSize;',
        )
        .replace(
          'gl_PointSize = sz * uPixel * uPointScale;',
          'gl_PointSize = sz * uPixel * uPointScale * uBloomSize;',
        ),
    )
  })

  it('freezes shader ABI preset ids and legacy uniform defaults', () => {
    expect(VISUAL_PRESETS.map(({ id, name }) => [id, name])).toEqual([
      [0, 'SILK'],
      [1, 'TUNNEL'],
      [2, 'ORBIT'],
      [3, 'VOID'],
      [4, 'VINYL'],
      [5, 'WALLPAPER'],
    ])
    expect(VISUAL_PRESETS.map(({ camera }) => camera)).toEqual([
      { radius: 6.6, phi: 0.08, theta: 0 },
      { radius: 6.2, phi: 0.03, theta: 0 },
      { radius: 7, phi: 0.15, theta: 0 },
      { radius: 8, phi: 0.05, theta: 0 },
      { radius: 6.5, phi: 0.04, theta: 0 },
      { radius: 9.4, phi: 0.34, theta: -0.52 },
    ])
    expect(DEFAULT_VISUAL_PARAMS).toEqual({
      intensity: 0.85,
      depth: 1,
      pointScale: 1,
      speed: 1,
      twist: 0,
      colorBoost: 1.1,
      scatter: 0,
      coverResolution: 1,
      backgroundFade: 0.2,
      bloomStrength: 0.62,
      bloomSize: 2.65,
      tintStrength: 0,
      alpha: 1,
      particleDim: 1,
    })
  })

  it('publishes one coherent nested snapshot and supports idempotent unsubscribe', () => {
    const bus = new VisualBus()
    const listener = vi.fn()
    const unsubscribe = bus.subscribe(listener)
    const frame: AnalyserFrame = { bass: 0.4, mid: 0.3, treble: 0.2, energy: 0.5, timestamp: 10 }

    bus.patch({ analyserFrame: frame, params: { speed: 1.2 }, preset: 3 })
    expect(bus.getSnapshot()).toMatchObject({
      analyserFrame: frame,
      params: { speed: 1.2 },
      preset: 3,
    })
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    unsubscribe()
    bus.setBeatPulse(0.8)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('disposes mixed resources once in reverse ownership order', () => {
    const order: string[] = []
    const registry = new ResourceRegistry()
    const releaseA = registry.add(() => order.push('a'))
    registry.add(() => order.push('b'))

    releaseA()
    releaseA()
    registry.disposeAll()
    registry.disposeAll()

    expect(order).toEqual(['a', 'b'])
    expect(registry.size).toBe(0)
  })
})

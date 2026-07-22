import * as THREE from 'three'
import { Text } from 'three-text'
import type { LyricWord } from '@shared/models'
import {
  EMPTY_LYRICS_3D_STATE,
  deriveLyrics3DState,
  selectLyricWindow,
  type Lyrics3DState,
  type Lyrics3DWindowEntry,
  type StageLyricsFrame,
} from './state'
import { ensureLyricsFont } from './harfbuzz'
import { lyricGlyphProgress } from './highlight'
import { createLyricsMaterial, type LyricsMaterialHandle } from './material'

const WINDOW_RADIUS = 2
const LINE_GAP = 0.64
/** three-text size in em-units; one world scale then maps geometry to stage units. */
const TEXT_SIZE = 1
const ACTIVE_SCALE = 0.52
const INACTIVE_SCALE = 0.34
const MIN_INACTIVE_SCALE = 0.26
const MAX_LINE_WIDTH = 7.2
const EXTRUDE_DEPTH = 0.095
const ACTIVE_COLOR = '#8fffe0'
const INACTIVE_COLOR = '#c4ced2'
const PENDING_COLOR = '#7f8d91'
const GEOMETRY_CACHE_LIMIT = 48
const BASE_Y = 0.24

interface RenderedLine {
  readonly index: number
  relativeIndex: number
  readonly mesh: THREE.Mesh
  readonly handle: LyricsMaterialHandle
  readonly centerX: number
  readonly centerY: number
  readonly width: number
  readonly glyphCount: number
  words: readonly LyricWord[]
  opacity: number
  y: number
  z: number
  scale: number
  rotationX: number
  activity: number
}

interface CachedGeometry {
  geometry: THREE.BufferGeometry
  centerX: number
  centerY: number
  width: number
  glyphCount: number
}

function normalizedText(value: string | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function ease(current: number, target: number, rate: number, deltaTime: number): number {
  const alpha = 1 - Math.exp(-rate * Math.max(0, deltaTime))
  return current + (target - current) * alpha
}

function safeColor(value: string, fallback: string): THREE.Color {
  try {
    return new THREE.Color(value)
  } catch {
    return new THREE.Color(fallback)
  }
}

/**
 * Mesh-based 3D lyric layer backed by three-text glyph geometry. Mirrors the canvas
 * layer's windowing/easing contract while rendering static extruded glyph meshes with
 * a fragment-level lyric highlight. Geometry generation is async + cached;
 * the ticker only mutates transforms and syncs uniforms, never blocking on shaping.
 */
export class Lyrics3DMeshLayer {
  readonly group = new THREE.Group()

  private readonly geometryCache = new Map<string, CachedGeometry>()
  private state: Lyrics3DState = { ...EMPTY_LYRICS_3D_STATE }
  private rendered: RenderedLine[] = []
  private signature = ''
  private buildToken = 0
  private fontBuffer: ArrayBuffer | null = null
  private fontError = false
  private disposed = false
  private playbackPosition = 0
  private accentColor = new THREE.Color(ACTIVE_COLOR)
  private viewportScale = 1
  private readonly activeColor = new THREE.Color()
  private readonly inactiveColor = new THREE.Color(INACTIVE_COLOR)
  private readonly pendingColor = new THREE.Color(PENDING_COLOR)
  private readonly whiteColor = new THREE.Color(0xffffff)
  private readonly offset = new THREE.Vector2()

  constructor() {
    this.group.name = 'stage-lyrics-3d-mesh'
    this.group.renderOrder = 42
    this.group.position.set(0, BASE_Y, 0)
    this.group.visible = false

    const key = new THREE.DirectionalLight(0xffffff, 2.1)
    key.position.set(-0.8, 1.2, 1.8)
    this.group.add(key)
    const rim = new THREE.DirectionalLight(0xa9d7ff, 0.72)
    rim.position.set(1.1, -0.35, 0.8)
    this.group.add(rim)
    this.group.add(new THREE.AmbientLight(0xffffff, 0.62))
  }

  setViewport(width: number, height: number): void {
    const aspectScale = THREE.MathUtils.clamp(width / Math.max(height, 1) / 1.45, 0.78, 1)
    const widthScale = THREE.MathUtils.clamp(width / 960, 0.78, 1)
    this.viewportScale = Math.min(aspectScale, widthScale)
  }

  setOffset(x: number, y: number): void {
    this.offset.set(x, y)
    this.group.position.set(x, BASE_Y + y, 0)
  }

  getOffset(): Readonly<{ x: number; y: number }> {
    return { x: this.offset.x, y: this.offset.y }
  }

  setFrame(frame: StageLyricsFrame): void {
    if (this.disposed) return

    const previousTrackKey = this.state.trackKey
    const nextState = deriveLyrics3DState(this.state, frame, WINDOW_RADIUS)
    const trackChanged = previousTrackKey !== nextState.trackKey
    const nextSignature = this.signatureFor(frame, nextState)

    if (trackChanged || !frame.visible) {
      this.clearRenderedLines()
      this.signature = ''
    }

    this.state = nextState

    if (!frame.visible || nextState.activeIndex < 0) {
      this.group.visible = false
      return
    }

    this.accentColor = safeColor(frame.accentColor, ACTIVE_COLOR)
    this.playbackPosition = frame.position
    for (const line of this.rendered) line.relativeIndex = line.index - nextState.activeIndex

    if (nextSignature && nextSignature !== this.signature) {
      this.signature = nextSignature
      const window = selectLyricWindow(frame.lines, nextState.activeIndex, WINDOW_RADIUS, WINDOW_RADIUS)
      void this.reconcileWindow(window)
    }
    this.group.visible = this.rendered.length > 0
  }

  update(deltaTime: number): void {
    if (this.disposed || !Number.isFinite(deltaTime)) return
    if (this.rendered.length === 0) return

    for (const line of this.rendered) {
      const distance = Math.abs(line.relativeIndex)
      const active = distance === 0
      const targetOpacity = active ? 1 : Math.max(0.08, 0.3 - distance * 0.08)
      const targetY = -line.relativeIndex * LINE_GAP
      const baseScale = active
        ? ACTIVE_SCALE
        : Math.max(MIN_INACTIVE_SCALE, INACTIVE_SCALE - distance * 0.035)
      const targetScale = Math.min(baseScale, MAX_LINE_WIDTH / Math.max(line.width, 1)) * this.viewportScale
      const targetZ = active ? 0.18 : -0.1 - distance * 0.14
      const targetRotationX = THREE.MathUtils.clamp(line.relativeIndex * 0.045, -0.1, 0.1)
      const targetActivity = active ? 1 : 0

      line.opacity = ease(line.opacity, targetOpacity, active ? 10 : 8, deltaTime)
      line.y = ease(line.y, targetY, 9, deltaTime)
      line.z = ease(line.z, targetZ, 8, deltaTime)
      line.scale = ease(line.scale, targetScale, 9, deltaTime)
      line.rotationX = ease(line.rotationX, targetRotationX, 8, deltaTime)
      line.activity = ease(line.activity, targetActivity, active ? 7 : 12, deltaTime)

      const material = line.handle.material
      this.activeColor.copy(this.accentColor).lerp(this.whiteColor, 0.28)
      material.color.copy(this.inactiveColor).lerp(this.pendingColor, line.activity)
      material.emissive.copy(this.accentColor)
      material.emissiveIntensity = 0.025 + line.activity * 0.055
      material.opacity = line.opacity
      line.handle.setHighlight(
        active ? lyricGlyphProgress(line.words, this.playbackPosition, line.glyphCount) : 0,
        line.activity,
        this.activeColor,
      )
      line.mesh.scale.setScalar(line.scale)
      line.mesh.rotation.x = line.rotationX
      line.mesh.position.set(
        -line.centerX * line.scale,
        line.y - line.centerY * line.scale,
        line.z,
      )
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.buildToken += 1
    this.clearRenderedLines()
    for (const cached of this.geometryCache.values()) cached.geometry.dispose()
    this.geometryCache.clear()
    this.group.visible = false
    this.group.parent?.remove(this.group)
  }

  private signatureFor(frame: Readonly<StageLyricsFrame>, state: Readonly<Lyrics3DState>): string {
    if (!frame.visible || state.activeIndex < 0) return ''
    const content = frame.lines
      .slice(state.windowStart, state.windowEnd + 1)
      .map((line) => `${line.time}${line.text}${line.ttext ?? ''}`)
      .join('')
    return `${frame.trackKey ?? ''}@${state.activeIndex}@${content}`
  }

  private async reconcileWindow(window: readonly Lyrics3DWindowEntry[]): Promise<void> {
    if (this.fontError) return
    const token = ++this.buildToken
    const desiredIndices = new Set(window.map((entry) => entry.index))
    for (const line of this.rendered) {
      if (!desiredIndices.has(line.index)) {
        this.group.remove(line.mesh)
        line.handle.material.dispose()
      }
    }
    this.rendered = this.rendered.filter((line) => desiredIndices.has(line.index))

    let font: ArrayBuffer
    try {
      font = this.fontBuffer ?? (this.fontBuffer = await ensureLyricsFont())
    } catch (error) {
      this.fontError = true
      console.error('[Lyrics3DMesh] 字体初始化失败:', error)
      return
    }
    if (this.disposed || token !== this.buildToken) return

    for (const entry of window) {
      const existing = this.rendered.find((line) => line.index === entry.index)
      if (existing) {
        existing.relativeIndex = entry.relativeIndex
        existing.words = entry.line.words ?? []
        continue
      }
      const text = normalizedText(entry.line.text)
      if (!text) continue
      let cached: CachedGeometry | null
      try {
        cached = await this.resolveGeometry(text, font)
      } catch (error) {
        console.error('[Lyrics3DMesh] 几何生成失败:', error)
        continue
      }
      if (this.disposed || token !== this.buildToken) return
      if (!cached) continue
      this.addLine(entry, cached)
    }
    this.group.visible = this.rendered.length > 0
  }

  private async resolveGeometry(text: string, font: ArrayBuffer): Promise<CachedGeometry | null> {
    const existing = this.geometryCache.get(text)
    if (existing) {
      this.geometryCache.delete(text)
      this.geometryCache.set(text, existing)
      return existing
    }

    const info = await Text.create({
      text,
      font,
      size: TEXT_SIZE,
      depth: EXTRUDE_DEPTH,
      fontVariations: { wght: 650 },
      perGlyphAttributes: true,
    })
    const geometry = info.geometry
    info.dispose()
    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    if (!box) return null
    const centerX = (box.max.x + box.min.x) / 2
    const centerY = (box.max.y + box.min.y) / 2
    const width = box.max.x - box.min.x
    const glyphIndices = geometry.getAttribute('glyphIndex')
    let glyphCount = 0
    for (let index = 0; index < glyphIndices.count; index += 1) {
      glyphCount = Math.max(glyphCount, glyphIndices.getX(index) + 1)
    }

    const cached: CachedGeometry = { geometry, centerX, centerY, width, glyphCount }
    this.geometryCache.set(text, cached)
    if (this.geometryCache.size > GEOMETRY_CACHE_LIMIT) {
      const oldestKey = this.geometryCache.keys().next().value
      if (oldestKey !== undefined && oldestKey !== text) {
        const oldest = this.geometryCache.get(oldestKey)
        if (oldest && !this.isGeometryInUse(oldest.geometry)) {
          oldest.geometry.dispose()
          this.geometryCache.delete(oldestKey)
        }
      }
    }
    return cached
  }

  private isGeometryInUse(geometry: THREE.BufferGeometry): boolean {
    return this.rendered.some((line) => line.mesh.geometry === geometry)
  }

  private addLine(
    entry: Readonly<Lyrics3DWindowEntry>,
    cached: CachedGeometry,
  ): void {
    const active = entry.relativeIndex === 0
    const color = active ? this.activeColor.copy(this.accentColor).lerp(this.whiteColor, 0.28) : this.inactiveColor
    const handle = createLyricsMaterial(color)
    handle.material.opacity = 0

    const mesh = new THREE.Mesh(cached.geometry, handle.material)
    mesh.renderOrder = active ? 43 : 41
    const baseScale = active ? ACTIVE_SCALE : INACTIVE_SCALE
    const scale = Math.min(baseScale, MAX_LINE_WIDTH / Math.max(cached.width, 1)) * this.viewportScale * 0.92
    const y = -entry.relativeIndex * LINE_GAP
    mesh.scale.setScalar(scale)
    mesh.position.set(-cached.centerX * scale, y - cached.centerY * scale, -0.28)

    this.group.add(mesh)
    this.rendered.push({
      index: entry.index,
      relativeIndex: entry.relativeIndex,
      mesh,
      handle,
      centerX: cached.centerX,
      centerY: cached.centerY,
      width: cached.width,
      glyphCount: cached.glyphCount,
      words: entry.line.words ?? [],
      opacity: 0,
      y,
      z: -0.28,
      scale,
      rotationX: entry.relativeIndex * 0.045,
      activity: 0,
    })
  }

  private clearRenderedLines(): void {
    for (const line of this.rendered) {
      this.group.remove(line.mesh)
      line.handle.material.dispose()
    }
    this.rendered = []
  }
}

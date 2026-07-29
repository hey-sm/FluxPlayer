import * as THREE from 'three'
import { Text } from 'three-text'
import type { LyricWord } from '@shared/models'
import { gsap } from '../../motion'
import {
  EMPTY_LYRICS_3D_STATE,
  deriveLyrics3DState,
  selectLyricWindow,
  type Lyrics3DState,
  type Lyrics3DWindowEntry,
  type StageLyricsFrame,
} from './state'
import { ensureHarfBuzz, fetchFace } from './harfbuzz'
import { LYRICS_FONT_WEIGHT } from './config'
import { resolveFontKey, type LyricsFontKey } from './fonts'
import { lyricGlyphProgress } from './highlight'
import { createLyricsMaterial, type LyricsMaterialHandle } from './material'
import {
  isLyricsAnimationMode,
  lyricsAnimationProfile,
  type LyricsAnimationMode,
} from './animation'

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
  readonly key: string
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
  exiting: boolean
  exitOrigin: { y: number; z: number; scale: number } | null
}

interface DesiredLine {
  key: string
  index: number
  relativeIndex: number
  text: string
  words: readonly LyricWord[]
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
  /** Per-key failures only skip lines needing that script, never the whole layer. */
  private readonly fontErrors = new Set<LyricsFontKey | 'harfbuzz'>()
  private disposed = false
  private playbackPosition = 0
  private accentColor = new THREE.Color(ACTIVE_COLOR)
  private viewportScale = 1
  private readonly activeColor = new THREE.Color()
  private readonly inactiveColor = new THREE.Color(INACTIVE_COLOR)
  private readonly pendingColor = new THREE.Color(PENDING_COLOR)
  private readonly whiteColor = new THREE.Color(0xffffff)
  private readonly offset = new THREE.Vector2()
  private animationMode: LyricsAnimationMode = 'compact'
  private reducedMotion = false
  private lastFrame: StageLyricsFrame | null = null

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
    for (const line of this.rendered) this.animateLine(line)
  }

  setOffset(x: number, y: number): void {
    this.offset.set(x, y)
    this.group.position.set(x, BASE_Y + y, 0)
  }

  getOffset(): Readonly<{ x: number; y: number }> {
    return { x: this.offset.x, y: this.offset.y }
  }

  setAnimationMode(mode: LyricsAnimationMode): void {
    if (!isLyricsAnimationMode(mode) || mode === this.animationMode) return
    this.animationMode = mode
    this.signature = ''
    if (this.lastFrame) this.setFrame(this.lastFrame)
  }

  setReducedMotion(reduced: boolean): void {
    if (this.reducedMotion === reduced) return
    this.reducedMotion = reduced
    for (const line of [...this.rendered]) this.animateLine(line)
  }

  setFrame(frame: StageLyricsFrame): void {
    if (this.disposed) return
    this.lastFrame = frame

    const previousTrackKey = this.state.trackKey
    const profile = lyricsAnimationProfile(this.animationMode)
    const nextState = deriveLyrics3DState(this.state, frame, profile.radius)
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

    if (nextSignature && nextSignature !== this.signature) {
      this.signature = nextSignature
      const window = selectLyricWindow(
        frame.lines,
        nextState.activeIndex,
        profile.radius,
        profile.radius,
      )
      void this.reconcileWindow(window)
    }
    this.group.visible = this.rendered.length > 0
  }

  update(deltaTime: number): void {
    if (this.disposed || !Number.isFinite(deltaTime)) return
    if (this.rendered.length === 0) return

    for (const line of this.rendered) {
      const distance = Math.abs(line.relativeIndex)
      const active = distance === 0 && !line.exiting

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
      .map((line) => `${line.time}${line.text}`)
      .join('')
    return `${this.animationMode}@${frame.trackKey ?? ''}@${state.activeIndex}@${content}`
  }

  private async reconcileWindow(window: readonly Lyrics3DWindowEntry[]): Promise<void> {
    if (this.fontErrors.has('harfbuzz')) return
    const token = ++this.buildToken
    const desired: DesiredLine[] = window.flatMap((entry) => {
      const text = normalizedText(entry.line.text)
      if (!text) return []
      return [
        {
          key: `line:${entry.index}`,
          index: entry.index,
          relativeIndex: entry.relativeIndex,
          text,
          words: entry.line.words ?? [],
        },
      ]
    })
    const desiredKeys = new Set(desired.map((entry) => entry.key))
    for (const entry of desired) {
      const existing = this.rendered.find((line) => line.key === entry.key)
      if (!existing) continue
      existing.relativeIndex = entry.relativeIndex
      existing.words = entry.words
      existing.exiting = false
      existing.exitOrigin = null
      this.animateLine(existing)
    }
    const missing = desired.filter(
      (entry) => !this.rendered.some((line) => line.key === entry.key),
    )
    if (missing.length === 0) {
      this.markExitingLines(desiredKeys)
      this.group.visible = this.rendered.length > 0
      return
    }

    try {
      await ensureHarfBuzz()
    } catch (error) {
      this.fontErrors.add('harfbuzz')
      console.error('[Lyrics3DMesh] HarfBuzz 初始化失败:', error)
      return
    }
    if (this.disposed || token !== this.buildToken) return

    for (const entry of missing) {
      const existing = this.rendered.find((line) => line.key === entry.key)
      if (existing) {
        existing.relativeIndex = entry.relativeIndex
        existing.words = entry.words
        existing.exiting = false
        existing.exitOrigin = null
        this.animateLine(existing)
        continue
      }
      const fontKey = resolveFontKey(entry.text)
      if (this.fontErrors.has(fontKey)) continue

      let font: ArrayBuffer
      try {
        font = await fetchFace(fontKey)
      } catch (error) {
        // A system missing one script's face must not disable the other scripts.
        this.fontErrors.add(fontKey)
        console.error(`[Lyrics3DMesh] 系统字体不可用 (${fontKey}):`, error)
        continue
      }
      if (this.disposed || token !== this.buildToken) return

      let cached: CachedGeometry | null
      try {
        cached = await this.resolveGeometry(entry.text, fontKey, font)
      } catch (error) {
        console.error('[Lyrics3DMesh] 几何生成失败:', error)
        continue
      }
      if (this.disposed || token !== this.buildToken) return
      if (!cached) continue
      this.addLine(entry, cached)
    }

    if (this.disposed || token !== this.buildToken) return
    this.markExitingLines(desiredKeys)
    this.group.visible = this.rendered.length > 0
  }

  private async resolveGeometry(
    text: string,
    fontKey: LyricsFontKey,
    font: ArrayBuffer,
  ): Promise<CachedGeometry | null> {
    // Same string shaped with a different face is a different geometry.
    const cacheKey = `${fontKey}\n${text}`
    const existing = this.geometryCache.get(cacheKey)
    if (existing) {
      this.geometryCache.delete(cacheKey)
      this.geometryCache.set(cacheKey, existing)
      return existing
    }

    const info = await Text.create({
      text,
      font,
      size: TEXT_SIZE,
      depth: EXTRUDE_DEPTH,
      // Static bold faces replace weight interpolation, and overlap removal stays off so
      // three-text keeps its single-pass tessellation — the two-pass path shreds dense
      // self-intersecting CJK contours.
      removeOverlaps: false,
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
    this.geometryCache.set(cacheKey, cached)
    if (this.geometryCache.size > GEOMETRY_CACHE_LIMIT) {
      const oldestKey = this.geometryCache.keys().next().value
      if (oldestKey !== undefined && oldestKey !== cacheKey) {
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

  private addLine(entry: Readonly<DesiredLine>, cached: CachedGeometry): void {
    const active = entry.relativeIndex === 0
    const color = active ? this.activeColor.copy(this.accentColor).lerp(this.whiteColor, 0.28) : this.inactiveColor
    const handle = createLyricsMaterial(color)
    handle.material.opacity = 0
    handle.setWeight(LYRICS_FONT_WEIGHT)

    const mesh = new THREE.Mesh(cached.geometry, handle.material)
    mesh.renderOrder = active ? 43 : 41
    const profile = lyricsAnimationProfile(this.animationMode)
    const baseScale = active ? ACTIVE_SCALE : INACTIVE_SCALE
    const targetScale =
      Math.min(baseScale, MAX_LINE_WIDTH / Math.max(cached.width, 1)) * this.viewportScale
    const scale = targetScale * profile.enterScale
    const targetY = -entry.relativeIndex * profile.lineGap
    const y = targetY + profile.enterOffsetY
    mesh.scale.setScalar(scale)
    mesh.position.set(
      -cached.centerX * scale,
      y - cached.centerY * scale,
      (active ? profile.activeZ : profile.inactiveZ) + profile.enterOffsetZ,
    )

    this.group.add(mesh)
    this.rendered.push({
      key: entry.key,
      index: entry.index,
      relativeIndex: entry.relativeIndex,
      mesh,
      handle,
      centerX: cached.centerX,
      centerY: cached.centerY,
      width: cached.width,
      glyphCount: cached.glyphCount,
      words: entry.words,
      opacity: 0,
      y,
      z: (active ? profile.activeZ : profile.inactiveZ) + profile.enterOffsetZ,
      scale,
      rotationX: entry.relativeIndex * profile.rotationStep,
      activity: 0,
      exiting: false,
      exitOrigin: null,
    })
    this.animateLine(this.rendered[this.rendered.length - 1])
  }

  private animateLine(line: RenderedLine): void {
    const profile = lyricsAnimationProfile(this.animationMode)
    const distance = Math.abs(line.relativeIndex)
    const active = distance === 0 && !line.exiting
    const baseScale = active
      ? ACTIVE_SCALE
      : Math.max(MIN_INACTIVE_SCALE, INACTIVE_SCALE - distance * 0.035)
    const stableScale =
      Math.min(baseScale, MAX_LINE_WIDTH / Math.max(line.width, 1)) * this.viewportScale
    const exitOrigin = line.exitOrigin ?? { y: line.y, z: line.z, scale: line.scale }
    const target = line.exiting
      ? {
          opacity: 0,
          y: exitOrigin.y + profile.exitOffsetY,
          z: exitOrigin.z + profile.exitOffsetZ,
          scale: exitOrigin.scale * profile.exitScale,
          rotationX: 0,
          activity: 0,
        }
      : {
          opacity: active
            ? 1
            : Math.max(0.06, profile.contextOpacity - distance * profile.contextOpacityStep),
          y: -line.relativeIndex * profile.lineGap,
          z: active ? profile.activeZ : profile.inactiveZ - distance * profile.depthStep,
          scale: stableScale,
          rotationX: THREE.MathUtils.clamp(
            line.relativeIndex * profile.rotationStep,
            -0.1,
            0.1,
          ),
          activity: active ? 1 : 0,
        }

    gsap.killTweensOf(line)
    line.mesh.renderOrder = active ? 43 : line.exiting ? 44 : 41
    if (this.reducedMotion) {
      Object.assign(line, target)
      if (line.exiting) this.removeLine(line)
      return
    }
    gsap.to(line, {
      ...target,
      duration: line.exiting ? profile.duration * 0.78 : profile.duration,
      ease: line.exiting ? profile.exitEase : profile.enterEase,
      overwrite: 'auto',
      onComplete: () => {
        if (line.exiting) this.removeLine(line)
      },
    })
  }

  private removeLine(line: RenderedLine): void {
    const index = this.rendered.indexOf(line)
    if (index < 0) return
    gsap.killTweensOf(line)
    this.rendered.splice(index, 1)
    this.group.remove(line.mesh)
    line.handle.material.dispose()
    this.group.visible = this.rendered.length > 0
  }

  private markExitingLines(desiredKeys: ReadonlySet<string>): void {
    for (const line of [...this.rendered]) {
      if (desiredKeys.has(line.key)) continue
      if (!line.exiting) line.exitOrigin = { y: line.y, z: line.z, scale: line.scale }
      line.exiting = true
      this.animateLine(line)
    }
  }

  private clearRenderedLines(): void {
    for (const line of this.rendered) {
      gsap.killTweensOf(line)
      this.group.remove(line.mesh)
      line.handle.material.dispose()
    }
    this.rendered = []
  }
}

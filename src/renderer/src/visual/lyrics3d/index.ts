import * as THREE from 'three'
import type { LyricLine } from '@shared/models'
import {
  EMPTY_LYRICS_3D_STATE,
  deriveLyrics3DState,
  selectLyricWindow,
  type Lyrics3DState,
  type Lyrics3DWindowEntry,
} from './state'

export interface StageLyricsFrame {
  trackKey: string | null
  lines: readonly LyricLine[]
  position: number
  accentColor: string
  visible: boolean
}

interface RenderedLine {
  readonly index: number
  readonly relativeIndex: number
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  readonly texture: THREE.CanvasTexture
  readonly line: LyricLine
  readonly canvas: HTMLCanvasElement
  readonly accentColor: string
  opacity: number
  y: number
  scale: number
}

const WINDOW_RADIUS = 2
const ACTIVE_COLOR = '#8fffe0'
const INACTIVE_COLOR = '#d8e4e3'
const ROOT_Z = 1.46
const LINE_GAP = 0.72

function normalizedText(value: string | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeAccentColor(value: string): string {
  const candidate = value.trim()
  return /^(#[\da-f]{3,8}|(?:rgb|hsl)a?\([^)]*\))$/i.test(candidate) ? candidate : ACTIVE_COLOR
}

function fitFont(context: CanvasRenderingContext2D, text: string, maximum: number, width: number): number {
  let size = maximum
  while (size > 25) {
    context.font = `600 ${size}px "Segoe UI", "Microsoft YaHei UI", sans-serif`
    if (context.measureText(text).width <= width) break
    size -= 2
  }
  return size
}

function makeLineTexture(
  entry: Readonly<Lyrics3DWindowEntry>,
  accentColor: string,
): { texture: THREE.CanvasTexture; aspect: number; canvas: HTMLCanvasElement } | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null

  try {
    const primary = normalizedText(entry.line.text)
    const translation = entry.relativeIndex === 0 ? normalizedText(entry.line.ttext) : ''
    if (!primary && !translation) return null

    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = translation ? 256 : 150
    const context = canvas.getContext('2d')
    if (!context) return null

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.shadowBlur = entry.relativeIndex === 0 ? 22 : 8
    context.shadowColor =
      entry.relativeIndex === 0 ? safeAccentColor(accentColor) : 'rgba(160, 210, 205, 0.35)'

    const primarySize = fitFont(context, primary, translation ? 72 : 76, canvas.width - 80)
    context.font = `600 ${primarySize}px "Segoe UI", "Microsoft YaHei UI", sans-serif`
    context.fillStyle = entry.relativeIndex === 0 ? safeAccentColor(accentColor) : INACTIVE_COLOR
    context.fillText(primary, canvas.width / 2, translation ? 88 : canvas.height / 2)

    if (translation) {
      const translationSize = fitFont(context, translation, 38, canvas.width - 120)
      context.shadowBlur = 7
      context.font = `500 ${translationSize}px "Segoe UI", "Microsoft YaHei UI", sans-serif`
      context.fillStyle = 'rgba(232, 244, 243, 0.82)'
      context.fillText(translation, canvas.width / 2, 178)
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.needsUpdate = true
    return { texture, aspect: canvas.width / canvas.height, canvas }
  } catch {
    return null
  }
}

function signatureFor(frame: Readonly<StageLyricsFrame>, state: Readonly<Lyrics3DState>): string {
  if (!frame.visible || state.activeIndex < 0) return ''
  const content = frame.lines
    .slice(state.windowStart, state.windowEnd + 1)
    .map((line) => `${line.time}\u0001${line.text}\u0001${line.ttext ?? ''}`)
    .join('\u0002')
  return `${frame.trackKey ?? ''}\u0000${state.activeIndex}\u0000${safeAccentColor(frame.accentColor)}\u0000${content}`
}

function ease(current: number, target: number, rate: number, deltaTime: number): number {
  const alpha = 1 - Math.exp(-rate * Math.max(0, deltaTime))
  return current + (target - current) * alpha
}

export class Lyrics3DLayer {
  readonly group = new THREE.Group()

  private state: Lyrics3DState = { ...EMPTY_LYRICS_3D_STATE }
  private rendered: RenderedLine[] = []
  private signature = ''
  private disposed = false

  constructor() {
    this.group.name = 'stage-lyrics-3d'
    this.group.renderOrder = 42
    this.group.position.set(0, 0.2, ROOT_Z)
    this.group.visible = false
  }

  setFrame(frame: StageLyricsFrame): void {
    if (this.disposed) return

    const previousTrackKey = this.state.trackKey
    const nextState = deriveLyrics3DState(this.state, frame, WINDOW_RADIUS)
    const trackChanged = previousTrackKey !== nextState.trackKey
    const nextSignature = signatureFor(frame, nextState)

    if (trackChanged || !frame.visible || nextSignature !== this.signature) {
      this.clearRenderedLines()
      this.signature = ''
    }

    this.state = nextState
    if (!frame.visible || nextState.activeIndex < 0) {
      this.group.visible = false
      return
    }

    if (this.rendered.length === 0) {
      const window = selectLyricWindow(frame.lines, nextState.activeIndex, WINDOW_RADIUS, WINDOW_RADIUS)
      this.buildWindow(window, frame.accentColor)
      this.signature = nextSignature
    }
    this.group.visible = this.rendered.length > 0
  }

  update(deltaTime: number): void {
    if (this.disposed || !this.group.visible || !Number.isFinite(deltaTime)) return

    for (const rendered of this.rendered) {
      const wordScale = 1
      const distance = Math.abs(rendered.relativeIndex)
      const active = distance === 0
      const targetOpacity = active ? 0.98 : Math.max(0.1, 0.34 - distance * 0.09)
      const targetY = -rendered.relativeIndex * LINE_GAP
      const targetScale = active ? 1 : Math.max(0.72, 0.86 - distance * 0.055)

      rendered.opacity = ease(rendered.opacity, targetOpacity, active ? 10 : 8, deltaTime)
      rendered.y = ease(rendered.y, targetY, 9, deltaTime)
      rendered.scale = ease(rendered.scale, targetScale, 9, deltaTime)
      rendered.mesh.material.opacity = rendered.opacity
      rendered.mesh.position.y = rendered.y
      rendered.mesh.scale.setScalar(rendered.scale * wordScale)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearRenderedLines()
    this.group.visible = false
    this.group.parent?.remove(this.group)
  }

  private buildWindow(window: readonly Lyrics3DWindowEntry[], accentColor: string): void {
    for (const entry of window) {
      const renderedTexture = makeLineTexture(entry, accentColor)
      if (!renderedTexture) continue

      const active = entry.relativeIndex === 0
      const worldWidth = active ? 6.1 : 5.25
      const worldHeight = worldWidth / renderedTexture.aspect
      const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight, 1, 1)
      const material = new THREE.MeshBasicMaterial({
        map: renderedTexture.texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: active ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
      const mesh = new THREE.Mesh(geometry, material)
      const targetY = -entry.relativeIndex * LINE_GAP
      mesh.renderOrder = active ? 43 : 41
      mesh.position.set(
        0,
        targetY + (entry.relativeIndex >= 0 ? -0.12 : 0.12),
        -Math.abs(entry.relativeIndex) * 0.018,
      )
      mesh.scale.setScalar(active ? 0.94 : 0.78)
      this.group.add(mesh)
      this.rendered.push({
        index: entry.index,
        relativeIndex: entry.relativeIndex,
        mesh,
        texture: renderedTexture.texture,
        line: entry.line,
        canvas: renderedTexture.canvas,
        accentColor,
        opacity: 0,
        y: mesh.position.y,
        scale: mesh.scale.x,
      })
    }
  }


  private clearRenderedLines(): void {
    for (const rendered of this.rendered) {
      this.group.remove(rendered.mesh)
      rendered.texture.dispose()
      rendered.mesh.geometry.dispose()
      rendered.mesh.material.dispose()
    }
    this.rendered = []
  }
}

export {
  EMPTY_LYRICS_3D_STATE,
  deriveLyrics3DState,
  findActiveLyricIndex,
  selectLyricWindow,
  type Lyrics3DState,
  type Lyrics3DStateInput,
  type Lyrics3DWindowEntry,
} from './state'

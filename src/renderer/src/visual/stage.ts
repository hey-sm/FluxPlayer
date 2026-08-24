import * as THREE from 'three'
import { ticker } from '@/perf/ticker'
import { DEFAULT_ACCENT_COLOR } from '@/theme/classic'
import {
  DynamicBackgroundManager,
  type DynamicBackgroundEffect,
  type DynamicBackgroundPointerInput,
} from './backgrounds'
import { Lyrics3DMeshLayer } from './lyrics3d-mesh'
import type { LyricsAnimationMode } from './lyrics3d-mesh/animation'
import { LYRICS_ZOOM_MAX_RADIUS, LYRICS_ZOOM_MIN_RADIUS } from './lyrics3d-mesh/config'
import { ResourceRegistry } from './resources'
import { stageLyricsChannel } from './scene'

interface CameraOrbit {
  radius: number
  phi: number
  theta: number
}

export class VisualStage {
  private readonly scene = new THREE.Scene()
  private readonly backgroundCamera = new THREE.PerspectiveCamera(37, 1, 0.1, 80)
  private readonly lyricsScene = new THREE.Scene()
  private readonly lyricsCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  private readonly renderer: THREE.WebGLRenderer
  private readonly backgrounds = new DynamicBackgroundManager()
  private readonly lyricsLayer = new Lyrics3DMeshLayer()
  private readonly resources = new ResourceRegistry()
  private readonly cameraState: CameraOrbit = { radius: 10.8, phi: 0.02, theta: 0 }
  private readonly cameraTarget: CameraOrbit = { radius: 10.8, phi: 0.02, theta: 0 }
  private container: HTMLElement | null = null
  private stopTick: (() => void) | null = null
  private backgroundEffect: DynamicBackgroundEffect = 'rain'
  private backgroundEnabled = true
  private accentColor = DEFAULT_ACCENT_COLOR
  private reducedMotion = false
  private disposed = false

  constructor() {
    this.scene.add(this.backgrounds.group)
    this.lyricsScene.add(this.lyricsLayer.group)
    this.lyricsLayer.setFrame(stageLyricsChannel.getSnapshot())
    this.resources.add(stageLyricsChannel.subscribe((frame) => this.lyricsLayer.setFrame(frame)))
    this.resources.add(() => {
      this.scene.remove(this.backgrounds.group)
      this.backgrounds.dispose()
    })
    this.resources.add(() => {
      this.lyricsScene.remove(this.lyricsLayer.group)
      this.lyricsLayer.dispose()
    })

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.autoClear = false
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35))
    const canvas = this.renderer.domElement
    canvas.style.background = 'transparent'
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    this.backgroundCamera.position.set(0, 0.2, 13.6)
    this.backgroundCamera.lookAt(0, 0, 0)
    this.backgroundCamera.updateMatrixWorld()
    this.applyCameraPosition()
  }

  mount(container: HTMLElement): void {
    if (this.disposed || this.container === container) return
    if (this.container) throw new Error('VisualStage is already mounted')
    this.container = container
    container.appendChild(this.renderer.domElement)
    this.resources.add(() => {
      if (this.renderer.domElement.parentElement === container) container.removeChild(this.renderer.domElement)
      this.container = null
    })
    this.applySize()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.applySize())
      observer.observe(container)
      this.resources.add(() => observer.disconnect())
    }

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const applyMotionPreference = (): void => {
      this.reducedMotion = motionQuery.matches
      this.lyricsLayer.setReducedMotion(this.reducedMotion)
      if (this.reducedMotion) this.backgrounds.setPointer(0.5, 0.5, false)
    }
    applyMotionPreference()
    motionQuery.addEventListener('change', applyMotionPreference)
    this.resources.add(() => motionQuery.removeEventListener('change', applyMotionPreference))
    this.syncBackground()
  }

  start(): () => void {
    if (this.stopTick) return this.stopTick
    const unregister = ticker.add((deltaTime) => {
      this.updateCamera(deltaTime)
      if (this.backgroundEnabled && !this.reducedMotion) this.backgrounds.update(deltaTime)
      this.lyricsLayer.update(deltaTime)
      this.renderer.clear()
      if (this.backgroundEnabled) this.renderer.render(this.scene, this.backgroundCamera)
      this.renderer.clearDepth()
      this.renderer.render(this.lyricsScene, this.lyricsCamera)
    })
    let active = true
    const stop = (): void => {
      if (!active) return
      active = false
      unregister()
      if (this.stopTick === stop) this.stopTick = null
    }
    this.stopTick = stop
    this.resources.add(stop)
    return stop
  }

  setBackgroundEffect(effect: DynamicBackgroundEffect): void {
    if (this.backgroundEffect === effect) return
    this.backgroundEffect = effect
    this.syncBackground()
  }

  setBackgroundEnabled(enabled: boolean): void {
    if (this.backgroundEnabled === enabled) return
    this.backgroundEnabled = enabled
    this.syncBackground()
  }

  setAccentColor(color: string): void {
    if (this.accentColor === color) return
    this.accentColor = color
    this.backgrounds.setAccentColor(color)
  }

  setPointer(clientX: number, clientY: number, active: boolean): void {
    if (!this.container || this.reducedMotion) return
    const rect = this.container.getBoundingClientRect()
    const x = rect.width ? (clientX - rect.left) / rect.width : 0.5
    const y = rect.height ? (clientY - rect.top) / rect.height : 0.5
    this.backgrounds.setPointer(x, y, active)
  }

  beginBackgroundPointer(
    clientX: number,
    clientY: number,
    button: number,
    pointerId: number,
  ): boolean {
    if (this.reducedMotion) return false
    return this.backgrounds.pointerDown(this.pointerInput(clientX, clientY, button, pointerId))
  }

  moveBackgroundPointer(clientX: number, clientY: number, button: number, pointerId: number): void {
    if (this.reducedMotion) return
    this.backgrounds.pointerMove(this.pointerInput(clientX, clientY, button, pointerId))
  }

  endBackgroundPointer(
    clientX: number,
    clientY: number,
    button: number,
    pointerId: number,
    cancelled = false,
  ): void {
    this.backgrounds.pointerUp({
      ...this.pointerInput(clientX, clientY, button, pointerId),
      cancelled,
    })
  }

  setLyricsAnimationMode(mode: LyricsAnimationMode): void {
    this.lyricsLayer.setAnimationMode(mode)
  }

  setLyricsFocusOnly(focusOnly: boolean): void {
    this.lyricsLayer.setFocusOnly(focusOnly)
  }

  setLyricsOffset(x: number, y: number): void {
    const bounds = this.lyricsOffsetBounds()
    this.lyricsLayer.setOffset(
      THREE.MathUtils.clamp(x, -bounds.x, bounds.x),
      THREE.MathUtils.clamp(y, -bounds.y, bounds.y),
    )
  }

  moveLyricsBy(deltaX: number, deltaY: number): Readonly<{ x: number; y: number }> {
    const height = Math.max(1, this.container?.clientHeight ?? 1)
    const visibleHeight =
      2 * Math.tan(THREE.MathUtils.degToRad(this.lyricsCamera.fov * 0.5)) * this.cameraState.radius
    const unitsPerPixel = visibleHeight / height
    const current = this.lyricsLayer.getOffset()
    this.setLyricsOffset(current.x + deltaX * unitsPerPixel, current.y - deltaY * unitsPerPixel)
    return this.lyricsLayer.getOffset()
  }

  rotateLyricsBy(deltaX: number, deltaY: number): void {
    this.cameraTarget.theta -= deltaX * 0.006
    this.cameraTarget.phi = THREE.MathUtils.clamp(this.cameraTarget.phi + deltaY * 0.006, -1.4, 1.4)
  }

  stopLyricsRotation(): void {
    // The camera eases to the final pointer target after release.
  }

  zoomLyrics(deltaY: number): void {
    this.cameraTarget.radius = THREE.MathUtils.clamp(
      this.cameraTarget.radius + deltaY * 0.005,
      LYRICS_ZOOM_MIN_RADIUS,
      LYRICS_ZOOM_MAX_RADIUS,
    )
  }

  getLyricsOffset(): Readonly<{ x: number; y: number }> {
    return this.lyricsLayer.getOffset()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopTick?.()
    this.stopTick = null
    this.resources.disposeAll()
    this.renderer.renderLists.dispose()
    this.renderer.dispose()
    this.scene.clear()
    this.lyricsScene.clear()
    this.container = null
  }

  private syncBackground(): void {
    this.backgrounds.setEffect(this.backgroundEnabled ? this.backgroundEffect : null)
  }

  private applySize(): void {
    if (!this.container || this.disposed) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height, false)
    this.backgrounds.setViewport(width, height, this.renderer.getPixelRatio())
    this.backgroundCamera.aspect = width / height
    this.backgroundCamera.updateProjectionMatrix()
    this.lyricsLayer.setViewport(width, height)
    this.lyricsCamera.aspect = width / height
    this.lyricsCamera.updateProjectionMatrix()
    const offset = this.lyricsLayer.getOffset()
    this.setLyricsOffset(offset.x, offset.y)
  }

  private lyricsOffsetBounds(): THREE.Vector2 {
    const visibleHeight =
      2 * Math.tan(THREE.MathUtils.degToRad(this.lyricsCamera.fov * 0.5)) * this.cameraState.radius
    return new THREE.Vector2(visibleHeight * this.lyricsCamera.aspect * 0.34, visibleHeight * 0.28)
  }

  private pointerInput(
    clientX: number,
    clientY: number,
    button: number,
    pointerId: number,
  ): DynamicBackgroundPointerInput {
    const rect = this.container?.getBoundingClientRect()
    return {
      x: rect?.width ? (clientX - rect.left) / rect.width : 0.5,
      y: rect?.height ? (clientY - rect.top) / rect.height : 0.5,
      button,
      pointerId,
    }
  }

  private updateCamera(deltaTime: number): void {
    const angleEase = 1 - Math.exp(-6.32 * Math.max(0, deltaTime))
    const radiusEase = 1 - Math.exp(-4.35 * Math.max(0, deltaTime))
    this.cameraState.theta += (this.cameraTarget.theta - this.cameraState.theta) * angleEase
    this.cameraState.phi += (this.cameraTarget.phi - this.cameraState.phi) * angleEase
    this.cameraState.radius += (this.cameraTarget.radius - this.cameraState.radius) * radiusEase
    this.applyCameraPosition()
  }

  private applyCameraPosition(): void {
    const { radius, phi, theta } = this.cameraState
    const cosPhi = Math.cos(phi)
    this.lyricsCamera.position.set(
      radius * cosPhi * Math.sin(theta),
      radius * Math.sin(phi),
      radius * cosPhi * Math.cos(theta),
    )
    this.lyricsCamera.lookAt(0, 0, 0)
    this.lyricsCamera.updateProjectionMatrix()
  }
}

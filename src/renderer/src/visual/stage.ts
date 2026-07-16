import * as THREE from 'three'
import { ticker } from '@/perf/ticker'
import { visualBus, type VisualBus, type VisualPreset, type VisualSnapshot } from './bus'
import { ResourceRegistry } from './resources'
import { VISUAL_PRESET_BY_ID } from './presets/registry'
import {
  advancePresetTransition,
  beginPresetTransition,
  cameraCartesian,
  legacyEase,
  mapPresetAudio,
  type PresetTransitionState,
} from './presets/runtime'
import type { VisualCameraBaseline } from './presets/types'
import { Lyrics3DLayer } from './lyrics3d'
import { stageLyricsChannel } from './scene'
import { vs, fs, bloomVs, bloomFs } from './shaders'
import { ModernBackgrounds } from './backgrounds'

const PLANE_SIZE = 4.8
const RIPPLE_MAX = 12
const DEFAULT_GRID = 118
const COVER_MIX_SPEED = 2.6
const LEGACY_CAMERA_SHAKE = 0.5
const BASE_CAMERA_FOV = 45

function makeDotTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 31)
  gradient.addColorStop(0, 'rgba(255,255,255,0.96)')
  gradient.addColorStop(0.42, 'rgba(255,255,255,0.78)')
  gradient.addColorStop(0.72, 'rgba(255,255,255,0.22)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

function buildCoverParticleGeometry(grid: number): THREE.BufferGeometry {
  const count = grid * grid
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const random = new Float32Array(count)
  const texelStep = 1 / grid

  for (let index = 0; index < count; index += 1) {
    const gridX = index % grid
    const gridY = Math.floor(index / grid)
    const x = gridX / (grid - 1)
    const y = gridY / (grid - 1)
    positions[index * 3] = (x - 0.5) * PLANE_SIZE
    positions[index * 3 + 1] = (y - 0.5) * PLANE_SIZE
    positions[index * 3 + 2] = 0
    uvs[index * 2] = (gridX + 0.5) * texelStep
    uvs[index * 2 + 1] = (gridY + 0.5) * texelStep
    random[index] = Math.random()
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('aRand', new THREE.BufferAttribute(random, 1))
  geometry.userData.grid = grid
  geometry.userData.count = count
  return geometry
}

function makePlaceholderTexture(css: string, size = 4): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  context.fillStyle = css
  context.fillRect(0, 0, size, size)
  const texture = new THREE.Texture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

function isVisualPreset(value: number): value is VisualPreset {
  return Number.isInteger(value) && ((value >= 0 && value <= 5) || (value >= 7 && value <= 9))
}

/** Three stage. All external state arrives through one VisualBus snapshot. */
export class VisualStage {
  private readonly resources = new ResourceRegistry()
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly renderer: THREE.WebGLRenderer
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.ShaderMaterial
  private readonly bloomMaterial: THREE.ShaderMaterial
  private readonly particles: THREE.Points
  private readonly bloomParticles: THREE.Points
  private readonly uniforms: Record<string, THREE.IUniform>
  private readonly textureLoader = new THREE.TextureLoader()
  private readonly placeholderCover: THREE.Texture
  private readonly lyricsLayer: Lyrics3DLayer
  private readonly modernBackgrounds: ModernBackgrounds

  private container: HTMLElement | null = null
  private stopTick: (() => void) | null = null
  private disposed = false
  private backgroundEnabled = true
  private pointerTarget = new THREE.Vector2()
  private pointerRotation = new THREE.Vector2()
  private lyricsRotationTarget = new THREE.Vector2()
  private lyricsRotation = new THREE.Vector2()
  private lyricsDepthTarget = 1.46
  private lyricsDepth = 1.46

  private coverGeneration = 0
  private coverUrl: string | null = null
  private activeCover: THREE.Texture
  private activeCoverRelease: (() => void) | null = null
  private transitionCover: THREE.Texture | null = null
  private transitionCoverRelease: (() => void) | null = null
  private presetTransition: PresetTransitionState | null = null
  private cameraPunch = 0
  private cameraState: VisualCameraBaseline = { radius: 6.6, phi: 0.08, theta: 0 }
  private cameraTarget: VisualCameraBaseline = { radius: 6.6, phi: 0.08, theta: 0 }

  constructor(private readonly bus: VisualBus = visualBus) {
    this.scene = new THREE.Scene()
    this.scene.background = null

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    this.camera.position.set(0, 0, 6.6)
    this.camera.lookAt(0, 0, 0)

    // Renderer teardown is explicit in dispose(); scene resources must be released first.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35))
    const canvas = this.renderer.domElement
    canvas.style.background = 'transparent'
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'

    const dotTexture = this.resources.track(makeDotTexture(), (texture) => texture.dispose())
    this.placeholderCover = this.resources.track(makePlaceholderTexture('#1c1c28'), (texture) =>
      texture.dispose(),
    )
    this.activeCover = this.placeholderCover
    const coverEdgeTexture = this.resources.track(makePlaceholderTexture('rgba(128,0,0,255)'), (texture) =>
      texture.dispose(),
    )
    const rippleTexture = this.resources.track(
      new THREE.DataTexture(
        new Float32Array(RIPPLE_MAX * 4),
        1,
        RIPPLE_MAX,
        THREE.RGBAFormat,
        THREE.FloatType,
      ),
      (texture) => texture.dispose(),
    )
    rippleTexture.magFilter = THREE.NearestFilter
    rippleTexture.minFilter = THREE.NearestFilter
    rippleTexture.needsUpdate = true

    this.uniforms = {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uBeat: { value: 0 },
      uEnergy: { value: 0 },
      uBurstAmt: { value: 0 },
      uVinylSpin: { value: 0 },
      uPreset: { value: 2 },
      uIntensity: { value: 0.85 },
      uDepth: { value: 1 },
      uPointScale: { value: 1 },
      uSpeed: { value: 1 },
      uTwist: { value: 0 },
      uColorBoost: { value: 1.1 },
      uScatter: { value: 0 },
      uCoverRes: { value: 1 },
      uBgFade: { value: 0.2 },
      uBloomStrength: { value: 0.62 },
      uBloomSize: { value: 2.65 },
      uTintColor: { value: new THREE.Color('#9db8cf') },
      uTintStrength: { value: 0 },
      uCoverTex: { value: this.placeholderCover },
      uPrevCoverTex: { value: this.placeholderCover },
      uColorMixT: { value: 1 },
      uEdgeTex: { value: coverEdgeTexture },
      uRippleTex: { value: rippleTexture },
      uRippleCount: { value: 0 },
      uDotTex: { value: dotTexture },
      uHasCover: { value: 0 },
      uHasDepth: { value: 0 },
      uEdgeEnabled: { value: 1 },
      uAiBoost: { value: 0 },
      uMouseXY: { value: new THREE.Vector2(-999, -999) },
      uMouseActive: { value: 0 },
      uHandXY: { value: new THREE.Vector2(-999, -999) },
      uHandActive: { value: 0 },
      uGestureGrip: { value: 0 },
      uPixel: { value: this.renderer.getPixelRatio() },
      uAlpha: { value: 1 },
      uParticleDim: { value: 1 },
      uFloatAlpha: { value: 0 },
      uLoading: { value: 0 },
    }

    this.geometry = this.resources.track(buildCoverParticleGeometry(DEFAULT_GRID), (geometry) =>
      geometry.dispose(),
    )
    this.material = this.resources.track(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: vs,
        fragmentShader: fs,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
      }),
      (material) => material.dispose(),
    )
    this.bloomMaterial = this.resources.track(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: bloomVs,
        fragmentShader: bloomFs,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
      (material) => material.dispose(),
    )

    this.bloomParticles = new THREE.Points(this.geometry, this.bloomMaterial)
    this.bloomParticles.frustumCulled = false
    this.bloomParticles.renderOrder = 0
    this.scene.add(this.bloomParticles)
    this.resources.add(() => this.scene.remove(this.bloomParticles))

    this.particles = new THREE.Points(this.geometry, this.material)
    this.particles.frustumCulled = false
    this.particles.renderOrder = 1
    this.scene.add(this.particles)
    this.resources.add(() => this.scene.remove(this.particles))

    this.modernBackgrounds = new ModernBackgrounds()
    this.scene.add(this.modernBackgrounds.group)
    this.resources.add(() => {
      this.scene.remove(this.modernBackgrounds.group)
      this.modernBackgrounds.dispose()
    })

    // Scene overlays share this Stage/Ticker and never create their own animation clocks.
    this.lyricsLayer = new Lyrics3DLayer()
    this.scene.add(this.lyricsLayer.group)
    this.resources.add(() => {
      this.scene.remove(this.lyricsLayer.group)
      this.lyricsLayer.dispose()
    })
    this.lyricsLayer.setFrame(stageLyricsChannel.getSnapshot())
    this.resources.add(stageLyricsChannel.subscribe((frame) => this.lyricsLayer.setFrame(frame)))

    this.applySnapshot(this.bus.getSnapshot(), null)
    this.resources.add(this.bus.subscribe((snapshot, previous) => this.applySnapshot(snapshot, previous)))
  }

  mount(container: HTMLElement): void {
    if (this.disposed || this.container === container) return
    if (this.container) throw new Error('VisualStage is already mounted')
    this.container = container
    container.appendChild(this.renderer.domElement)
    this.resources.add(() => {
      if (this.renderer.domElement.parentElement === container) {
        container.removeChild(this.renderer.domElement)
      }
      this.container = null
    })
    this.applySize()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.applySize())
      observer.observe(container)
      this.resources.add(() => observer.disconnect())
    }
  }

  start(): () => void {
    if (this.stopTick) return this.stopTick
    const unregister = ticker.add((deltaTime) => {
      if (this.backgroundEnabled) {
        this.uniforms.uTime.value += deltaTime
        this.tickVinylSpin(deltaTime)
        this.tickPresetTransition(deltaTime)
        this.updateCamera(deltaTime)
        const pointerEase = 1 - Math.exp(-3.4 * Math.max(0, deltaTime))
        this.pointerRotation.lerp(this.pointerTarget, pointerEase)
        this.particles.rotation.set(this.pointerRotation.y, this.pointerRotation.x, 0)
        this.bloomParticles.rotation.copy(this.particles.rotation)
        this.modernBackgrounds.group.rotation.set(this.pointerRotation.y, this.pointerRotation.x, 0)
        const snapshot = this.bus.getSnapshot()
        this.modernBackgrounds.update(deltaTime, snapshot.analyserFrame, snapshot.beatPulse)
        if (this.uniforms.uColorMixT.value < 1) {
          this.uniforms.uColorMixT.value = Math.min(
            1,
            this.uniforms.uColorMixT.value + deltaTime * COVER_MIX_SPEED,
          )
          if (this.uniforms.uColorMixT.value >= 1) this.finishCoverTransition()
        }
      }
      const lyricsEase = 1 - Math.exp(-7 * Math.max(0, deltaTime))
      this.lyricsRotation.lerp(this.lyricsRotationTarget, lyricsEase)
      this.lyricsDepth += (this.lyricsDepthTarget - this.lyricsDepth) * lyricsEase
      this.lyricsLayer.group.rotation.set(this.lyricsRotation.y, this.lyricsRotation.x, 0)
      this.lyricsLayer.group.position.z = this.lyricsDepth
      this.lyricsLayer.update(deltaTime)
      this.renderer.render(this.scene, this.camera)
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

  setPreset(preset: number): void {
    if (isVisualPreset(preset)) this.bus.setPreset(preset)
  }

  setBackgroundEnabled(enabled: boolean): void {
    if (this.backgroundEnabled === enabled) return
    this.backgroundEnabled = enabled
    const preset = this.bus.getSnapshot().preset
    const modern = ModernBackgrounds.supports(preset)
    this.particles.visible = enabled && !modern
    this.bloomParticles.visible = enabled && !modern && this.bus.getSnapshot().params.bloomStrength > 0.01
    this.modernBackgrounds.group.visible = enabled && modern
    if (enabled) {
      this.applySnapshot(this.bus.getSnapshot(), null)
    } else {
      this.stopCoverRotation()
      this.coverGeneration += 1
      this.releaseDynamicCovers()
      this.uniforms.uCoverTex.value = this.placeholderCover
      this.uniforms.uPrevCoverTex.value = this.placeholderCover
      this.uniforms.uHasCover.value = 0
      this.uniforms.uColorMixT.value = 1
    }
  }

  rotateCoverBy(deltaX: number, deltaY: number): void {
    this.pointerTarget.x += deltaX * 0.008
    this.pointerTarget.y += deltaY * 0.008
  }

  stopCoverRotation(): void {
    // Drop the remaining eased delta so releasing the button stops rotation immediately.
    this.pointerTarget.copy(this.pointerRotation)
  }

  rotateLyricsBy(deltaX: number, deltaY: number): void {
    this.lyricsRotationTarget.x = THREE.MathUtils.clamp(this.lyricsRotationTarget.x + deltaX * 0.006, -0.75, 0.75)
    this.lyricsRotationTarget.y = THREE.MathUtils.clamp(this.lyricsRotationTarget.y + deltaY * 0.006, -0.55, 0.55)
  }

  stopLyricsRotation(): void {
    this.lyricsRotationTarget.copy(this.lyricsRotation)
  }

  zoomLyrics(deltaY: number): void {
    this.lyricsDepthTarget = THREE.MathUtils.clamp(this.lyricsDepthTarget + deltaY * 0.0025, 0.2, 3.4)
  }

  zoomCover(deltaY: number): void {
    this.cameraTarget.radius = THREE.MathUtils.clamp(this.cameraTarget.radius + deltaY * 0.005, 3.2, 12)
  }


  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.coverGeneration += 1
    this.stopTick?.()
    this.stopTick = null
    this.releaseDynamicCovers()
    this.resources.disposeAll()
    this.renderer.renderLists.dispose()
    this.renderer.dispose()
    this.scene.clear()
    this.container = null
  }

  private applySize(): void {
    if (!this.container || this.disposed) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.uniforms.uPixel.value = this.renderer.getPixelRatio()
  }

  private applySnapshot(snapshot: Readonly<VisualSnapshot>, previous: Readonly<VisualSnapshot> | null): void {
    if (!this.backgroundEnabled) return
    const frame = snapshot.analyserFrame
    const params = snapshot.params
    const mappedAudio = mapPresetAudio(frame, snapshot.beatPulse, snapshot.preset, params.intensity)
    this.uniforms.uBass.value = mappedAudio.bass
    this.uniforms.uMid.value = mappedAudio.mid
    this.uniforms.uTreble.value = mappedAudio.treble
    this.uniforms.uEnergy.value = frame.energy
    this.uniforms.uBeat.value = mappedAudio.beat
    const modern = ModernBackgrounds.supports(snapshot.preset)
    this.uniforms.uPreset.value = modern ? 2 : snapshot.preset
    this.modernBackgrounds.setPreset(snapshot.preset)
    this.modernBackgrounds.group.visible = this.backgroundEnabled && modern
    this.particles.visible = this.backgroundEnabled && !modern
    this.uniforms.uIntensity.value = params.intensity
    this.uniforms.uDepth.value = params.depth
    this.uniforms.uPointScale.value = params.pointScale
    this.uniforms.uSpeed.value = params.speed
    this.uniforms.uTwist.value = params.twist
    this.uniforms.uColorBoost.value = params.colorBoost
    this.uniforms.uScatter.value = params.scatter
    this.uniforms.uCoverRes.value = params.coverResolution
    this.uniforms.uBgFade.value = params.backgroundFade
    this.uniforms.uBloomStrength.value = params.bloomStrength
    this.uniforms.uBloomSize.value = params.bloomSize
    this.uniforms.uTintStrength.value = params.tintStrength
    this.uniforms.uAlpha.value = params.alpha
    this.uniforms.uParticleDim.value = params.particleDim
    this.uniforms.uTintColor.value.set(snapshot.accentColor)

    if (!previous || snapshot.preset !== previous.preset) {
      this.applyPresetProfile(snapshot.preset, Boolean(previous))
    }
    this.bloomParticles.visible = !modern && params.bloomStrength > 0.01
    if (!previous || snapshot.coverUrl !== previous.coverUrl) this.loadCover(snapshot.coverUrl)
  }

  private applyPresetProfile(preset: VisualPreset, animate: boolean): void {
    const definition = VISUAL_PRESET_BY_ID.get(preset)
    if (!definition) return
    this.cameraTarget = { ...definition.camera }
    if (!animate) {
      this.cameraState = { ...definition.camera }
      this.applyCameraPosition()
      this.presetTransition = null
      return
    }

    const params = this.bus.getSnapshot().params
    const profile = definition.transition
    this.presetTransition = beginPresetTransition(profile)
    this.uniforms.uScatter.value = Math.max(
      Number(this.uniforms.uScatter.value) || 0,
      params.scatter + profile.initialScatter,
    )
    this.uniforms.uBurstAmt.value = Math.max(Number(this.uniforms.uBurstAmt.value) || 0, profile.initialBurst)
    this.cameraPunch = Math.max(this.cameraPunch, profile.cameraPunch)
  }

  private tickVinylSpin(deltaTime: number): void {
    const snapshot = this.bus.getSnapshot()
    const speedMultiplier = Number.isFinite(snapshot.params.speed) ? Math.max(0.05, snapshot.params.speed) : 1
    const spinSpeed = (0.4 + snapshot.analyserFrame.bass * 0.09) * speedMultiplier
    const next = (Number(this.uniforms.uVinylSpin.value) || 0) + Math.max(0, deltaTime) * spinSpeed
    this.uniforms.uVinylSpin.value = next % (Math.PI * 2)
  }

  private tickPresetTransition(deltaTime: number): void {
    const decay = Math.pow(0.9, Math.max(0, deltaTime) * 60)
    this.uniforms.uBurstAmt.value = (Number(this.uniforms.uBurstAmt.value) || 0) * decay
    if (!this.presetTransition) return

    const params = this.bus.getSnapshot().params
    const frame = advancePresetTransition(this.presetTransition, deltaTime, params.scatter, params.pointScale)
    this.presetTransition = frame.state
    this.uniforms.uScatter.value = Math.max(Number(this.uniforms.uScatter.value) || 0, frame.scatter)
    this.uniforms.uBurstAmt.value = Math.max(Number(this.uniforms.uBurstAmt.value) || 0, frame.burst)
    this.uniforms.uPointScale.value = frame.pointScale
    if (!frame.state) {
      this.uniforms.uScatter.value = params.scatter
      this.uniforms.uPointScale.value = params.pointScale
    }
  }

  private updateCamera(deltaTime: number): void {
    const angleEase = legacyEase(0.1, deltaTime)
    const radiusEase = legacyEase(0.07, deltaTime)
    this.cameraState.theta += (this.cameraTarget.theta - this.cameraState.theta) * angleEase
    this.cameraState.phi += (this.cameraTarget.phi - this.cameraState.phi) * angleEase
    this.cameraState.radius += (this.cameraTarget.radius - this.cameraState.radius) * radiusEase
    this.applyCameraPosition()

    const targetFov = BASE_CAMERA_FOV - this.cameraPunch * 0.55 * LEGACY_CAMERA_SHAKE * 2.35
    const fovEase = legacyEase(targetFov < this.camera.fov ? 0.24 : 0.12, deltaTime)
    this.camera.fov += (targetFov - this.camera.fov) * fovEase
    this.camera.updateProjectionMatrix()
    this.cameraPunch *= Math.pow(0.86, Math.max(0, deltaTime) * 60)
  }

  private applyCameraPosition(): void {
    const position = cameraCartesian(this.cameraState)
    this.camera.position.set(position.x, position.y, position.z)
    this.camera.lookAt(0, 0, 0)
  }

  private loadCover(url: string | null): void {
    this.coverGeneration += 1
    const generation = this.coverGeneration
    this.coverUrl = url

    if (!url) {
      this.releaseDynamicCovers()
      this.activeCover = this.placeholderCover
      this.uniforms.uCoverTex.value = this.placeholderCover
      this.uniforms.uPrevCoverTex.value = this.placeholderCover
      this.uniforms.uColorMixT.value = 1
      this.uniforms.uHasCover.value = 0
      return
    }

    this.textureLoader.load(
      url,
      (texture) => {
        if (this.disposed || generation !== this.coverGeneration || url !== this.coverUrl) {
          texture.dispose()
          return
        }
        texture.minFilter = THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.wrapS = THREE.ClampToEdgeWrapping
        texture.wrapT = THREE.ClampToEdgeWrapping

        this.transitionCoverRelease?.()
        this.transitionCover = this.activeCover
        this.transitionCoverRelease = this.activeCoverRelease
        this.activeCover = texture
        this.activeCoverRelease = this.resources.add(() => texture.dispose())

        this.uniforms.uPrevCoverTex.value = this.transitionCover
        this.uniforms.uCoverTex.value = texture
        this.uniforms.uColorMixT.value = 0
        this.uniforms.uHasCover.value = 1
      },
      undefined,
      () => {
        if (generation === this.coverGeneration && this.activeCover === this.placeholderCover) {
          this.uniforms.uHasCover.value = 0
        }
      },
    )
  }

  private finishCoverTransition(): void {
    this.transitionCoverRelease?.()
    this.transitionCoverRelease = null
    this.transitionCover = null
    this.uniforms.uPrevCoverTex.value = this.activeCover
  }

  private releaseDynamicCovers(): void {
    this.transitionCoverRelease?.()
    this.activeCoverRelease?.()
    this.transitionCoverRelease = null
    this.activeCoverRelease = null
    this.transitionCover = null
    this.activeCover = this.placeholderCover
  }
}

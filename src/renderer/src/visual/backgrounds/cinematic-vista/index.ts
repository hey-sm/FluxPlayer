import * as THREE from 'three'
import { disposeObjectTree } from '../resources'
import type { BackgroundUpdateFrame, MusicVisualBackground } from '../types'
import { CINEMATIC_FOG_FRAGMENT_SHADER, CINEMATIC_FOG_VERTEX_SHADER } from './shaders'

const CORRIDOR_DEPTHS = [7, 4.1, 1.2, -1.7, -4.6, -7.5] as const
const FRAME_INSTANCE_COUNT = CORRIDOR_DEPTHS.length * 4 + 4
const FOG_LAYER_COUNT = 7
const DUST_COUNT = 360

function makeFallbackCoverTexture(size = 64): THREE.DataTexture {
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = x / (size - 1) - 0.5
      const ny = y / (size - 1) - 0.5
      const radial = Math.max(0, 1 - Math.hypot(nx * 1.35, ny * 1.35) * 1.7)
      const horizon = Math.max(0, 1 - Math.abs(ny + 0.08) * 3.4)
      const glow = Math.min(1, radial * 0.72 + horizon * 0.28)
      const offset = (y * size + x) * 4
      pixels[offset] = Math.round(10 + glow * 88)
      pixels[offset + 1] = Math.round(15 + glow * 66)
      pixels[offset + 2] = Math.round(28 + glow * 126)
      pixels[offset + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat)
  texture.name = 'cinematic-vista-fallback-cover'
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

function makeLightVolumeGeometry(): THREE.BufferGeometry {
  const nearZ = -8.75
  const farZ = 7.8
  const positions = new Float32Array([
    -1.9, -1.2, nearZ,
    1.9, -1.2, nearZ,
    1.9, 2.6, nearZ,
    -1.9, 2.6, nearZ,
    -6.4, -3.2, farZ,
    6.4, -3.2, farZ,
    6.4, 4.8, farZ,
    -6.4, 4.8, farZ,
  ])
  const indices = [
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

function deterministic(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

/** Independent cinematic long-shot reconstruction; no external site code or assets are used. */
export class CinematicVistaBackground implements MusicVisualBackground {
  readonly group = new THREE.Group()
  private readonly content = new THREE.Group()
  private readonly windowAssembly = new THREE.Group()
  private readonly fallbackCover = makeFallbackCoverTexture()
  private readonly windowMaterial: THREE.MeshBasicMaterial
  private readonly haloMaterial: THREE.MeshBasicMaterial
  private readonly volumeMaterial: THREE.MeshBasicMaterial
  private readonly architectureMaterial: THREE.MeshStandardMaterial
  private readonly fogMaterial: THREE.ShaderMaterial
  private readonly dustMaterial: THREE.PointsMaterial
  private readonly dust: THREE.Points
  private readonly accent = new THREE.Color('#8aa7d8')
  private readonly accentDim = new THREE.Color('#111827')
  private disposed = false
  private elapsed = 0
  private lastAccent = ''

  constructor() {
    this.group.name = 'cinematic-vista-background'
    this.group.userData.backgroundPreset = 10
    this.content.name = 'cinematic-vista-architecture'
    this.windowAssembly.name = 'cinematic-vista-window-assembly'
    this.group.add(this.content)

    this.architectureMaterial = new THREE.MeshStandardMaterial({
      color: 0x070910,
      emissive: 0x0b1325,
      emissiveIntensity: 0.3,
      roughness: 0.84,
      metalness: 0.34,
    })
    const frameGeometry = new THREE.BoxGeometry(1, 1, 1)
    const frames = new THREE.InstancedMesh(frameGeometry, this.architectureMaterial, FRAME_INSTANCE_COUNT)
    frames.name = 'cinematic-vista-frames'
    frames.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    const dummy = new THREE.Object3D()
    let frameIndex = 0
    for (const depth of CORRIDOR_DEPTHS) {
      for (const x of [-5.45, 5.45]) {
        dummy.position.set(x, 0.55, depth)
        dummy.scale.set(0.42, 8.4, 0.52)
        dummy.updateMatrix()
        frames.setMatrixAt(frameIndex, dummy.matrix)
        frameIndex += 1
      }
      for (const y of [-3.45, 4.55]) {
        dummy.position.set(0, y, depth)
        dummy.scale.set(11.3, 0.34, 0.52)
        dummy.updateMatrix()
        frames.setMatrixAt(frameIndex, dummy.matrix)
        frameIndex += 1
      }
    }
    const facadePieces = [
      { position: [-3.85, 0.65, -8.92], scale: [3.2, 8.1, 0.42] },
      { position: [3.85, 0.65, -8.92], scale: [3.2, 8.1, 0.42] },
      { position: [0, 3.65, -8.92], scale: [4.5, 2.05, 0.42] },
      { position: [0, -2.35, -8.92], scale: [4.5, 2.05, 0.42] },
    ] as const
    for (const piece of facadePieces) {
      dummy.position.set(piece.position[0], piece.position[1], piece.position[2])
      dummy.scale.set(piece.scale[0], piece.scale[1], piece.scale[2])
      dummy.updateMatrix()
      frames.setMatrixAt(frameIndex, dummy.matrix)
      frameIndex += 1
    }
    frames.instanceMatrix.needsUpdate = true
    this.content.add(frames)

    const surfaceGeometry = new THREE.BoxGeometry(1, 1, 1)
    const surfaces = new THREE.InstancedMesh(surfaceGeometry, this.architectureMaterial, 2)
    surfaces.name = 'cinematic-vista-floor-ceiling'
    dummy.position.set(0, -3.72, 0)
    dummy.scale.set(12.2, 0.18, 24)
    dummy.updateMatrix()
    surfaces.setMatrixAt(0, dummy.matrix)
    dummy.position.set(0, 4.84, 0)
    dummy.scale.set(12.2, 0.16, 24)
    dummy.updateMatrix()
    surfaces.setMatrixAt(1, dummy.matrix)
    surfaces.instanceMatrix.needsUpdate = true
    this.content.add(surfaces)

    this.windowMaterial = new THREE.MeshBasicMaterial({ map: this.fallbackCover, toneMapped: false })
    const windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.55, 3.55), this.windowMaterial)
    windowMesh.name = 'cinematic-vista-cover-window'
    windowMesh.renderOrder = 3
    this.windowAssembly.position.set(0, 0.65, -8.66)
    this.windowAssembly.add(windowMesh)

    this.haloMaterial = new THREE.MeshBasicMaterial({
      color: this.accent,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 5.3), this.haloMaterial)
    halo.name = 'cinematic-vista-window-halo'
    halo.position.z = -0.08
    halo.renderOrder = 2
    this.windowAssembly.add(halo)
    this.content.add(this.windowAssembly)

    this.volumeMaterial = new THREE.MeshBasicMaterial({
      color: this.accent,
      transparent: true,
      opacity: 0.035,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    const lightVolume = new THREE.Mesh(makeLightVolumeGeometry(), this.volumeMaterial)
    lightVolume.name = 'cinematic-vista-light-volume'
    lightVolume.renderOrder = 1
    this.content.add(lightVolume)

    this.fogMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uColor: { value: new THREE.Color(0x5d6f8d) },
      },
      vertexShader: CINEMATIC_FOG_VERTEX_SHADER,
      fragmentShader: CINEMATIC_FOG_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const fog = new THREE.InstancedMesh(new THREE.PlaneGeometry(13, 8), this.fogMaterial, FOG_LAYER_COUNT)
    fog.name = 'cinematic-vista-fog-layers'
    for (let index = 0; index < FOG_LAYER_COUNT; index += 1) {
      dummy.position.set(0, 0.45, 6.3 - index * 2.25)
      dummy.scale.setScalar(1 + index * 0.045)
      dummy.updateMatrix()
      fog.setMatrixAt(index, dummy.matrix)
    }
    fog.instanceMatrix.needsUpdate = true
    fog.renderOrder = 4
    this.content.add(fog)

    const dustPositions = new Float32Array(DUST_COUNT * 3)
    for (let index = 0; index < DUST_COUNT; index += 1) {
      dustPositions[index * 3] = (deterministic(index, 1) - 0.5) * 11.2
      dustPositions[index * 3 + 1] = (deterministic(index, 2) - 0.5) * 8.2 + 0.5
      dustPositions[index * 3 + 2] = deterministic(index, 3) * 17 - 8.2
    }
    const dustGeometry = new THREE.BufferGeometry()
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
    this.dustMaterial = new THREE.PointsMaterial({
      color: 0xb9c9e8,
      size: 0.028,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
    this.dust = new THREE.Points(dustGeometry, this.dustMaterial)
    this.dust.name = 'cinematic-vista-dust'
    this.content.add(this.dust)

    const ambient = new THREE.AmbientLight(0x172238, 0.72)
    const windowLight = new THREE.PointLight(0x8aa7d8, 34, 27, 1.7)
    windowLight.name = 'cinematic-vista-window-light'
    windowLight.position.set(0, 0.7, -7.7)
    this.content.add(ambient, windowLight)
  }

  setCoverTexture(texture: THREE.Texture | null): void {
    if (this.disposed) return
    const map = texture ?? this.fallbackCover
    if (this.windowMaterial.map === map) return
    this.windowMaterial.map = map
    this.windowMaterial.needsUpdate = true
  }

  update(
    deltaTime: number,
    { analyserFrame: frame, beatPulse, accentColor }: Readonly<BackgroundUpdateFrame>,
  ): void {
    if (this.disposed) return
    const dt = Math.max(0, deltaTime)
    this.elapsed += dt
    this.content.position.x = Math.sin(this.elapsed * 0.075) * 0.12
    this.content.position.y = Math.cos(this.elapsed * 0.061) * 0.045
    this.windowAssembly.position.x = Math.sin(this.elapsed * 0.052) * -0.07
    this.windowAssembly.position.y = 0.65 + Math.cos(this.elapsed * 0.047) * 0.035
    this.dust.position.z = ((this.dust.position.z + dt * (0.045 + frame.energy * 0.11) + 0.5) % 1) - 0.5
    this.dustMaterial.opacity = Math.min(0.58, 0.26 + frame.treble * 0.22 + beatPulse * 0.08)
    this.haloMaterial.opacity = Math.min(0.52, 0.16 + frame.energy * 0.2 + beatPulse * 0.16)
    this.volumeMaterial.opacity = Math.min(0.09, 0.025 + frame.mid * 0.035 + beatPulse * 0.018)
    this.fogMaterial.uniforms.uTime.value = this.elapsed
    this.fogMaterial.uniforms.uEnergy.value = frame.energy

    if (accentColor !== this.lastAccent) {
      this.lastAccent = accentColor
      this.accent.set(accentColor)
      this.accentDim.copy(this.accent).multiplyScalar(0.08)
      this.haloMaterial.color.copy(this.accent)
      this.volumeMaterial.color.copy(this.accent)
      this.architectureMaterial.emissive.copy(this.accentDim)
      this.fogMaterial.uniforms.uColor.value.copy(this.accent).lerp(new THREE.Color(0x64748b), 0.64)
      const windowLight = this.content.getObjectByName('cinematic-vista-window-light') as THREE.PointLight | undefined
      windowLight?.color.copy(this.accent)
    }
    this.architectureMaterial.emissiveIntensity = 0.24 + frame.bass * 0.25
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.windowMaterial.map = null
    disposeObjectTree(this.group)
    this.fallbackCover.dispose()
  }
}

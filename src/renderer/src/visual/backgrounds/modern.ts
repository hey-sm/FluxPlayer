import * as THREE from 'three'
import type { AnalyserFrame, VisualPreset } from '../bus'

const MODERN_PRESETS = new Set<VisualPreset>([7, 8, 9])

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const renderable = object as THREE.Mesh | THREE.Points
    const geometry = renderable.geometry
    if (geometry) geometry.dispose()
    const materials = Array.isArray(renderable.material) ? renderable.material : renderable.material ? [renderable.material] : []
    for (const material of materials) material.dispose()
  })
}

export class ModernBackgrounds {
  readonly group = new THREE.Group()
  private readonly nebula = new THREE.Group()
  private readonly crystal = new THREE.Group()
  private readonly skyline = new THREE.Group()
  private readonly nebulaMaterial: THREE.PointsMaterial
  private readonly crystalMaterial: THREE.MeshStandardMaterial
  private readonly skylineMaterial: THREE.MeshStandardMaterial
  private readonly crystalMesh: THREE.InstancedMesh
  private readonly skylineMesh: THREE.InstancedMesh
  private readonly dummy = new THREE.Object3D()
  private active: VisualPreset = 7
  private disposed = false
  private elapsed = 0

  constructor() {
    this.group.name = 'modern-music-backgrounds'
    this.nebula.name = 'nebula-tunnel'
    this.crystal.name = 'crystal-wavefield'
    this.skyline.name = 'geometric-skyline'
    this.group.add(this.nebula, this.crystal, this.skyline)

    const positions: number[] = []
    const colors: number[] = []
    const color = new THREE.Color()
    for (let index = 0; index < 1800; index += 1) {
      const depth = (index / 1800) * 34 - 17
      const angle = index * 2.399963 + Math.sin(index * 0.17) * 0.7
      const radius = 1.6 + (index % 23) / 23 * 4.8
      positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, depth)
      color.setHSL(0.58 + (index % 17) / 170, 0.82, 0.55 + (index % 5) * 0.04)
      colors.push(color.r, color.g, color.b)
    }
    const nebulaGeometry = new THREE.BufferGeometry()
    nebulaGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    nebulaGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    this.nebulaMaterial = new THREE.PointsMaterial({ size: 0.055, vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false, blending: THREE.AdditiveBlending })
    this.nebula.add(new THREE.Points(nebulaGeometry, this.nebulaMaterial))

    const crystalGeometry = new THREE.OctahedronGeometry(0.16, 0)
    this.crystalMaterial = new THREE.MeshStandardMaterial({ color: 0x77bbff, emissive: 0x102a55, roughness: 0.18, metalness: 0.45, wireframe: false, transparent: true, opacity: 0.88 })
    const crystalCount = 19 * 13
    this.crystalMesh = new THREE.InstancedMesh(crystalGeometry, this.crystalMaterial, crystalCount)
    this.crystalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.crystal.add(this.crystalMesh)

    const skylineGeometry = new THREE.BoxGeometry(0.18, 1, 0.18)
    this.skylineMaterial = new THREE.MeshStandardMaterial({ color: 0xffbb66, emissive: 0x3b1605, roughness: 0.3, metalness: 0.62 })
    this.skylineMesh = new THREE.InstancedMesh(skylineGeometry, this.skylineMaterial, 160)
    this.skylineMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.skyline.add(this.skylineMesh)

    const ambient = new THREE.AmbientLight(0x6688bb, 0.75)
    const key = new THREE.PointLight(0xaaccff, 28, 24)
    key.position.set(2, 4, 5)
    this.group.add(ambient, key)
    this.setPreset(7)
  }

  static supports(preset: VisualPreset): boolean { return MODERN_PRESETS.has(preset) }

  setPreset(preset: VisualPreset): void {
    this.active = preset
    this.group.visible = ModernBackgrounds.supports(preset)
    this.nebula.visible = preset === 7
    this.crystal.visible = preset === 8
    this.skyline.visible = preset === 9
  }

  update(deltaTime: number, frame: Readonly<AnalyserFrame>, beat: number): void {
    if (!this.group.visible || this.disposed) return
    const dt = Math.max(0, deltaTime)
    this.elapsed += dt
    if (this.active === 7) {
      this.nebula.rotation.z += dt * (0.045 + frame.mid * 0.12)
      this.nebula.position.z = ((this.nebula.position.z + dt * (0.7 + frame.bass * 2.4) + 17) % 34) - 17
      this.nebulaMaterial.size = 0.045 + frame.treble * 0.085 + beat * 0.025
      this.nebulaMaterial.opacity = 0.62 + frame.energy * 0.32
    } else if (this.active === 8) {
      let index = 0
      for (let z = 0; z < 13; z += 1) for (let x = 0; x < 19; x += 1) {
        const px = (x - 9) * 0.38
        const pz = (z - 6) * 0.42
        const wave = Math.sin(px * 1.7 + pz * 1.25 + this.elapsed * 1.8) * (0.24 + frame.mid * 0.7)
        const scale = 0.72 + frame.treble * 1.2 + Math.max(0, wave) * 0.8
        this.dummy.position.set(px, wave - 0.6, pz)
        this.dummy.rotation.set(wave * 0.9, px * 0.12, pz * 0.1)
        this.dummy.scale.setScalar(scale)
        this.dummy.updateMatrix(); this.crystalMesh.setMatrixAt(index++, this.dummy.matrix)
      }
      this.crystalMesh.instanceMatrix.needsUpdate = true
      this.crystalMaterial.emissiveIntensity = 0.45 + frame.bass * 1.4 + beat
      this.crystal.rotation.y += dt * 0.08
    } else {
      for (let index = 0; index < 160; index += 1) {
        const angle = index / 160 * Math.PI * 2
        const ring = 2.2 + (index % 5) * 0.23
        const height = 0.45 + ((index * 13) % 17) / 17 * 1.8 + frame.bass * 2.1 + beat * (index % 7 === 0 ? 1.4 : 0.15)
        this.dummy.position.set(Math.cos(angle) * ring, -1.4 + height * 0.5, Math.sin(angle) * ring)
        this.dummy.rotation.set(0, -angle, 0)
        this.dummy.scale.set(0.8, height, 0.8)
        this.dummy.updateMatrix(); this.skylineMesh.setMatrixAt(index, this.dummy.matrix)
      }
      this.skylineMesh.instanceMatrix.needsUpdate = true
      this.skylineMaterial.emissiveIntensity = 0.38 + frame.treble * 1.3 + beat * 0.7
      this.skyline.rotation.y += dt * (0.035 + frame.mid * 0.08)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    disposeObject(this.group)
    this.group.clear()
  }
}
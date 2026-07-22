import * as THREE from 'three'
import { disposeObjectTree } from '../resources'
import type { BackgroundUpdateFrame, MusicVisualBackground } from '../types'

export class CrystalBackground implements MusicVisualBackground {
  readonly group = new THREE.Group()
  private readonly material: THREE.MeshStandardMaterial
  private readonly mesh: THREE.InstancedMesh
  private readonly dummy = new THREE.Object3D()
  private disposed = false
  private elapsed = 0

  constructor() {
    this.group.name = 'crystal-wavefield-background'
    const geometry = new THREE.OctahedronGeometry(0.16, 0)
    this.material = new THREE.MeshStandardMaterial({
      color: 0x77bbff,
      emissive: 0x102a55,
      roughness: 0.18,
      metalness: 0.45,
      transparent: true,
      opacity: 0.88,
    })
    this.mesh = new THREE.InstancedMesh(geometry, this.material, 19 * 13)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.group.add(this.mesh)

    const ambient = new THREE.AmbientLight(0x6688bb, 0.75)
    const key = new THREE.PointLight(0xaaccff, 28, 24)
    key.position.set(2, 4, 5)
    this.group.add(ambient, key)
  }

  setCoverTexture(_texture: THREE.Texture | null): void {}

  update(deltaTime: number, { analyserFrame: frame, beatPulse }: Readonly<BackgroundUpdateFrame>): void {
    if (this.disposed) return
    const dt = Math.max(0, deltaTime)
    this.elapsed += dt
    let index = 0
    for (let z = 0; z < 13; z += 1) {
      for (let x = 0; x < 19; x += 1) {
        const px = (x - 9) * 0.38
        const pz = (z - 6) * 0.42
        const wave = Math.sin(px * 1.7 + pz * 1.25 + this.elapsed * 1.8) * (0.24 + frame.mid * 0.7)
        const scale = 0.72 + frame.treble * 1.2 + Math.max(0, wave) * 0.8
        this.dummy.position.set(px, wave - 0.6, pz)
        this.dummy.rotation.set(wave * 0.9, px * 0.12, pz * 0.1)
        this.dummy.scale.setScalar(scale)
        this.dummy.updateMatrix()
        this.mesh.setMatrixAt(index, this.dummy.matrix)
        index += 1
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.material.emissiveIntensity = 0.45 + frame.bass * 1.4 + beatPulse
    this.group.rotation.y += dt * 0.08
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    disposeObjectTree(this.group)
  }
}

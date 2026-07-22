import * as THREE from 'three'
import { disposeObjectTree } from '../resources'
import type { BackgroundUpdateFrame, MusicVisualBackground } from '../types'

export class SkylineBackground implements MusicVisualBackground {
  readonly group = new THREE.Group()
  private readonly material: THREE.MeshStandardMaterial
  private readonly mesh: THREE.InstancedMesh
  private readonly dummy = new THREE.Object3D()
  private disposed = false

  constructor() {
    this.group.name = 'geometric-skyline-background'
    const geometry = new THREE.BoxGeometry(0.18, 1, 0.18)
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffbb66,
      emissive: 0x3b1605,
      roughness: 0.3,
      metalness: 0.62,
    })
    this.mesh = new THREE.InstancedMesh(geometry, this.material, 160)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.group.add(this.mesh)

    const ambient = new THREE.AmbientLight(0x4d536b, 0.65)
    const key = new THREE.PointLight(0xffc784, 24, 20)
    key.position.set(-2, 4, 4)
    this.group.add(ambient, key)
  }

  setCoverTexture(_texture: THREE.Texture | null): void {}

  update(deltaTime: number, { analyserFrame: frame, beatPulse }: Readonly<BackgroundUpdateFrame>): void {
    if (this.disposed) return
    const dt = Math.max(0, deltaTime)
    for (let index = 0; index < 160; index += 1) {
      const angle = (index / 160) * Math.PI * 2
      const ring = 2.2 + (index % 5) * 0.23
      const height =
        0.45 +
        (((index * 13) % 17) / 17) * 1.8 +
        frame.bass * 2.1 +
        beatPulse * (index % 7 === 0 ? 1.4 : 0.15)
      this.dummy.position.set(Math.cos(angle) * ring, -1.4 + height * 0.5, Math.sin(angle) * ring)
      this.dummy.rotation.set(0, -angle, 0)
      this.dummy.scale.set(0.8, height, 0.8)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(index, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.material.emissiveIntensity = 0.38 + frame.treble * 1.3 + beatPulse * 0.7
    this.group.rotation.y += dt * (0.035 + frame.mid * 0.08)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    disposeObjectTree(this.group)
  }
}

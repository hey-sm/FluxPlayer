import * as THREE from 'three'
import { disposeObjectTree } from '../resources'
import type { BackgroundUpdateFrame, MusicVisualBackground } from '../types'

export class NebulaBackground implements MusicVisualBackground {
  readonly group = new THREE.Group()
  private readonly material: THREE.PointsMaterial
  private disposed = false

  constructor() {
    this.group.name = 'nebula-tunnel-background'
    const positions: number[] = []
    const colors: number[] = []
    const color = new THREE.Color()
    for (let index = 0; index < 1800; index += 1) {
      const depth = (index / 1800) * 34 - 17
      const angle = index * 2.399963 + Math.sin(index * 0.17) * 0.7
      const radius = 1.6 + ((index % 23) / 23) * 4.8
      positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, depth)
      color.setHSL(0.58 + (index % 17) / 170, 0.82, 0.55 + (index % 5) * 0.04)
      colors.push(color.r, color.g, color.b)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    this.material = new THREE.PointsMaterial({
      size: 0.055,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.group.add(new THREE.Points(geometry, this.material))
  }

  setCoverTexture(_texture: THREE.Texture | null): void {}

  update(deltaTime: number, { analyserFrame: frame, beatPulse }: Readonly<BackgroundUpdateFrame>): void {
    if (this.disposed) return
    const dt = Math.max(0, deltaTime)
    this.group.rotation.z += dt * (0.045 + frame.mid * 0.12)
    this.group.position.z = ((this.group.position.z + dt * (0.7 + frame.bass * 2.4) + 17) % 34) - 17
    this.material.size = 0.045 + frame.treble * 0.085 + beatPulse * 0.025
    this.material.opacity = 0.62 + frame.energy * 0.32
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    disposeObjectTree(this.group)
  }
}

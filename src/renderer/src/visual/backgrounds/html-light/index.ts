/*
 * Adapted from jinruozai/HTML-Light-Demo at commit 0a0bd3ba53194fff68db78654fc6857ab3faee29.
 * Copyright (c) 2026 Gooooo. MIT License; see THIRD_PARTY_NOTICES.md.
 * Original concept and art direction credited upstream to https://x.com/kaolti.
 *
 * FluxPlayer keeps the lamp geometry, light rig, and constrained Verlet pendulum while replacing
 * the HTMLTexture page with an owned procedural surface so the effect can share the existing
 * renderer, ticker, and accessible DOM UI.
 */
import * as THREE from 'three'
import { disposeObjectTree } from '../resources'
import type { DynamicBackground, DynamicBackgroundPointerInput } from '../types'

const DOWN = new THREE.Vector3(0, -1, 0)
const UP = new THREE.Vector3(0, 1, 0)
const CAMERA_FOV = 37
const CAMERA_DISTANCE = 13.6
const FIXED_STEP = 1 / 120
const ROPE_LENGTH = 0.94
const LIGHT_COLOR = '#ffb36b'
const SPOTLIGHT_POWER = 2050
const SPOTLIGHT_ANGLE = 54
const SPOTLIGHT_PENUMBRA = 0.94

function createGlowTexture(): THREE.DataTexture {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5) / size - 0.5
      const dy = (y + 0.5) / size - 0.5
      const distance = Math.min(1, Math.hypot(dx, dy) * 2)
      const intensity = Math.pow(1 - distance, 2.25)
      const offset = (y * size + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = Math.round(intensity * 255)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function createSurfaceTexture(): THREE.DataTexture {
  const width = 256
  const height = 144
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const grid = x % 16 === 0 || y % 16 === 0 ? 5 : 0
      const nx = x / width - 0.72
      const ny = y / height - 0.28
      const ambient = Math.max(0, 1 - Math.hypot(nx, ny) * 1.75) * 5
      const offset = (y * width + x) * 4
      data[offset] = 6 + grid + Math.round(ambient * 0.55)
      data[offset + 1] = 8 + grid + Math.round(ambient * 0.72)
      data[offset + 2] = 13 + grid + Math.round(ambient)
      data[offset + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export class HtmlLightBackground implements DynamicBackground {
  readonly group = new THREE.Group()

  private readonly surfaceTexture = createSurfaceTexture()
  private readonly glowTexture = createGlowTexture()
  private readonly surface: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
  private readonly backdrop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly ceilingCap: THREE.Mesh
  private readonly cable: THREE.Mesh
  private readonly undersideMaterial: THREE.MeshStandardMaterial
  private readonly bulbMaterial: THREE.MeshStandardMaterial
  private readonly glowMaterial: THREE.SpriteMaterial
  private readonly spotLight: THREE.SpotLight
  private readonly bulbLight: THREE.PointLight
  private readonly lampRoot = new THREE.Group()
  private readonly anchor = new THREE.Vector3(0, 4.2, 1.18)
  private readonly position = new THREE.Vector3(0.16, 2.98, 1.26)
  private readonly previous = this.position.clone().add(new THREE.Vector3(0.018, 0, -0.012))
  private readonly aimTarget = new THREE.Vector3(0, 0.3, 0.08)
  private readonly pointerVelocity = new THREE.Vector3()
  private readonly lastPointerTarget = this.aimTarget.clone()
  private readonly temp = new THREE.Vector3()
  private readonly tempB = new THREE.Vector3()
  private readonly tempC = new THREE.Vector3()
  private readonly velocity = new THREE.Vector3()
  private readonly ropeDirection = new THREE.Vector3()
  private readonly lightDirection = new THREE.Vector3()
  private readonly currentLightDirection = DOWN.clone()
  private readonly midpoint = new THREE.Vector3()
  private readonly swingQuaternion = new THREE.Quaternion()
  private readonly lampQuaternion = new THREE.Quaternion()
  private readonly cableQuaternion = new THREE.Quaternion()

  private visibleWidth = 16
  private visibleHeight = 9
  private accumulator = 0
  private stableFrames = 0
  private pulling = false
  private pullPointerId = -1
  private pullStrength = 0
  private lastPointerTime = 0
  private disposed = false

  constructor() {
    this.group.name = 'html-light-background'
    this.group.userData.backgroundEffect = 'html-light'
    this.lampRoot.name = 'html-light-lamp-root'

    const backdropMaterial = new THREE.MeshBasicMaterial({ color: 0x010204 })
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backdropMaterial)
    this.backdrop.name = 'html-light-backdrop'
    this.backdrop.position.z = -0.055
    this.backdrop.renderOrder = -102
    this.group.add(this.backdrop)

    const surfaceMaterial = new THREE.MeshStandardMaterial({
      map: this.surfaceTexture,
      color: 0x707784,
      roughness: 0.96,
      metalness: 0,
    })
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), surfaceMaterial)
    this.surface.name = 'html-light-surface'
    this.surface.position.z = -0.025
    this.surface.renderOrder = -101
    this.group.add(this.surface)

    const ambient = new THREE.HemisphereLight(0x71809b, 0x09070a, 0.42)
    this.group.add(ambient)
    const fillLight = new THREE.DirectionalLight(0x91a6c8, 0.2)
    fillLight.position.set(-4.8, 5.6, 7.4)
    this.group.add(fillLight)

    this.ceilingCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.3, 0.11, 24),
      new THREE.MeshStandardMaterial({ color: 0x101218, roughness: 0.64, metalness: 0.7 }),
    )
    this.ceilingCap.name = 'html-light-ceiling-cap'
    this.group.add(this.ceilingCap)

    this.cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 1, 10),
      new THREE.MeshStandardMaterial({ color: 0x121318, roughness: 0.5, metalness: 0.55 }),
    )
    this.cable.name = 'html-light-cable'
    this.group.add(this.cable, this.lampRoot)

    const shadeGroup = new THREE.Group()
    this.lampRoot.add(shadeGroup)
    const shadeProfile = [
      new THREE.Vector2(0.08, 0.08),
      new THREE.Vector2(0.18, 0.02),
      new THREE.Vector2(0.43, -0.1),
      new THREE.Vector2(0.82, -0.25),
      new THREE.Vector2(1.08, -0.36),
      new THREE.Vector2(1.1, -0.41),
    ]
    const shade = new THREE.Mesh(
      new THREE.LatheGeometry(shadeProfile, 48),
      new THREE.MeshStandardMaterial({
        color: 0x101116,
        roughness: 0.36,
        metalness: 0.74,
        side: THREE.DoubleSide,
      }),
    )
    shadeGroup.add(shade)

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.095, 0.027, 8, 48),
      new THREE.MeshStandardMaterial({ color: 0x17191f, roughness: 0.28, metalness: 0.82 }),
    )
    rim.rotation.x = Math.PI / 2
    rim.position.y = -0.397
    shadeGroup.add(rim)

    this.undersideMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(LIGHT_COLOR).multiplyScalar(0.18),
        emissive: LIGHT_COLOR,
        emissiveIntensity: 0.42,
        roughness: 0.92,
        side: THREE.DoubleSide,
      })
    const underside = new THREE.Mesh(new THREE.CircleGeometry(1.055, 48), this.undersideMaterial)
    underside.rotation.x = Math.PI / 2
    underside.position.y = -0.385
    shadeGroup.add(underside)

    const connector = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.12, 0.2, 20),
      new THREE.MeshStandardMaterial({ color: 0x9c6744, roughness: 0.44, metalness: 0.66 }),
    )
    connector.position.y = 0.08
    shadeGroup.add(connector)

    this.bulbMaterial = new THREE.MeshStandardMaterial({
        color: 0xffd7ad,
        emissive: LIGHT_COLOR,
        emissiveIntensity: 3.2,
        roughness: 0.2,
      })
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12), this.bulbMaterial)
    bulb.scale.y = 1.2
    bulb.position.y = -0.33
    shadeGroup.add(bulb)

    this.glowMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: LIGHT_COLOR,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const glow = new THREE.Sprite(this.glowMaterial)
    glow.position.y = -0.36
    glow.scale.set(0.96, 0.96, 0.96)
    shadeGroup.add(glow)

    this.spotLight = new THREE.SpotLight(
      LIGHT_COLOR,
      1,
      18,
      THREE.MathUtils.degToRad(SPOTLIGHT_ANGLE),
      SPOTLIGHT_PENUMBRA,
      2,
    )
    this.spotLight.power = SPOTLIGHT_POWER
    this.spotLight.position.set(0, -0.35, 0)
    this.spotLight.target.position.set(0, -6, -3.2)
    shadeGroup.add(this.spotLight, this.spotLight.target)

    this.bulbLight = new THREE.PointLight(LIGHT_COLOR, 1, 3.2, 2)
    this.bulbLight.power = 36
    this.bulbLight.position.set(0, -0.35, 0)
    shadeGroup.add(this.bulbLight)

    this.setAccentColor(LIGHT_COLOR)
    this.updateRig()
  }

  setAccentColor(value: string): void {
    const color = new THREE.Color(value)
    this.undersideMaterial.color.copy(color).multiplyScalar(0.18)
    this.undersideMaterial.emissive.copy(color)
    this.bulbMaterial.color.copy(color).lerp(new THREE.Color(0xffffff), 0.42)
    this.bulbMaterial.emissive.copy(color)
    this.glowMaterial.color.copy(color)
    this.spotLight.color.copy(color)
    this.bulbLight.color.copy(color)
  }

  setViewport(width: number, height: number, _pixelRatio: number): void {
    const aspect = Math.max(1, width) / Math.max(1, height)
    this.visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV * 0.5)) * CAMERA_DISTANCE
    this.visibleWidth = this.visibleHeight * aspect
    const surfaceWidth = this.visibleWidth * 1.06
    const surfaceHeight = this.visibleHeight * 1.08
    this.surface.scale.set(surfaceWidth, surfaceHeight, 1)
    this.backdrop.scale.set(surfaceWidth, surfaceHeight, 1)

    const nextAnchorY = this.visibleHeight * 0.465
    const previousAnchor = this.anchor.clone()
    this.anchor.set(0, nextAnchorY, 1.18)
    if (!this.pulling) {
      this.position.add(this.temp.copy(this.anchor).sub(previousAnchor))
      this.temp.copy(this.position).sub(this.anchor)
      if (this.temp.lengthSq() < 0.001) this.temp.copy(DOWN)
      this.temp.normalize().multiplyScalar(ROPE_LENGTH)
      this.position.copy(this.anchor).add(this.temp)
      this.previous.copy(this.position)
    }
    this.updateRig()
  }

  setPointer(_x: number, _y: number, active: boolean): void {
    if (!active && this.pulling) this.releasePointer(true)
  }

  pointerDown(input: DynamicBackgroundPointerInput): boolean {
    if (
      this.disposed ||
      this.pulling ||
      input.button !== 0 ||
      input.y < 0.035 ||
      input.y > 0.39 ||
      Math.abs(input.x - 0.5) > 0.24
    ) {
      return false
    }
    this.updateAimTarget(input)
    this.pulling = true
    this.pullPointerId = input.pointerId
    this.pullStrength = 0
    this.pointerVelocity.set(0, 0, 0)
    this.lastPointerTarget.copy(this.aimTarget)
    this.lastPointerTime = performance.now()
    this.stableFrames = 0
    return true
  }

  pointerMove(input: DynamicBackgroundPointerInput): void {
    if (!this.pulling || input.pointerId !== this.pullPointerId) return
    this.updateAimTarget(input)
    const now = performance.now()
    const elapsed = Math.max(0.008, Math.min(0.05, (now - this.lastPointerTime) / 1000))
    this.temp.copy(this.aimTarget).sub(this.lastPointerTarget).multiplyScalar(1 / elapsed)
    this.pointerVelocity.lerp(this.temp, 0.34)
    this.lastPointerTarget.copy(this.aimTarget)
    this.lastPointerTime = now
    this.stableFrames = 0
  }

  pointerUp(input: DynamicBackgroundPointerInput): void {
    if (!this.pulling || input.pointerId !== this.pullPointerId) return
    this.releasePointer(Boolean(input.cancelled))
  }

  update(deltaTime: number): void {
    if (this.disposed || (!this.pulling && this.stableFrames >= 80)) return
    const delta = Math.min(Math.max(0, deltaTime), 0.05)
    this.accumulator = Math.min(this.accumulator + delta, FIXED_STEP * 5)
    while (this.accumulator >= FIXED_STEP) {
      this.stepPhysics()
      this.accumulator -= FIXED_STEP
    }
    this.updateRig()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.surfaceTexture.dispose()
    this.glowTexture.dispose()
    disposeObjectTree(this.group)
    this.group.clear()
  }

  private updateAimTarget(input: DynamicBackgroundPointerInput): void {
    this.aimTarget.set(
      (input.x - 0.5) * this.visibleWidth,
      (0.5 - input.y) * this.visibleHeight,
      0.08,
    )
    const screenDistance = Math.hypot((input.x - 0.5) * 1.4, input.y - 0.18)
    this.pullStrength = THREE.MathUtils.smoothstep(screenDistance, 0.03, 0.48)
  }

  private releasePointer(cancelled: boolean): void {
    if (!cancelled) {
      this.velocity.copy(this.position).sub(this.previous).multiplyScalar(1 / FIXED_STEP)
      this.temp.copy(this.position).sub(this.anchor).normalize()
      this.pointerVelocity.addScaledVector(this.temp, -this.pointerVelocity.dot(this.temp)).clampLength(0, 6)
      this.velocity.addScaledVector(this.pointerVelocity, THREE.MathUtils.lerp(0.045, 0.105, this.pullStrength))
      this.velocity.clampLength(0, 4.25)
      this.previous.copy(this.position).addScaledVector(this.velocity, -FIXED_STEP)
    } else {
      this.previous.copy(this.position)
    }
    this.pulling = false
    this.pullPointerId = -1
    this.pullStrength = 0
    this.stableFrames = 0
  }

  private stepPhysics(): void {
    this.velocity.copy(this.position).sub(this.previous).multiplyScalar(this.pulling ? 0.985 : 0.9948)
    this.previous.copy(this.position)
    this.position.add(this.velocity).addScaledVector(DOWN, 9.81 * FIXED_STEP * FIXED_STEP)

    if (this.pulling) {
      this.tempB.copy(this.aimTarget).sub(this.anchor).normalize()
      this.tempB.lerp(DOWN, 1 - this.pullStrength * 0.82).normalize()
      this.tempC.copy(this.tempB).multiplyScalar(ROPE_LENGTH).add(this.anchor).sub(this.position)
      this.temp.copy(this.position).sub(this.anchor).normalize()
      this.tempC.addScaledVector(this.temp, -this.tempC.dot(this.temp))
      this.position.addScaledVector(this.tempC, 52 * FIXED_STEP * FIXED_STEP)
    }

    this.temp.copy(this.position).sub(this.anchor)
    if (this.temp.lengthSq() < 1e-8) this.temp.copy(DOWN)
    this.temp.normalize().multiplyScalar(ROPE_LENGTH)
    this.position.copy(this.anchor).add(this.temp)

    this.velocity.copy(this.position).sub(this.previous)
    if (this.pulling) this.stableFrames = 0
    else if (this.velocity.lengthSq() < 0.000000014) this.stableFrames += 1
    else this.stableFrames = 0
  }

  private updateRig(): void {
    this.ropeDirection.copy(this.position).sub(this.anchor).normalize()
    this.midpoint.copy(this.anchor).add(this.position).multiplyScalar(0.5)
    this.cable.position.copy(this.midpoint)
    this.cable.scale.set(1, ROPE_LENGTH, 1)
    this.cableQuaternion.setFromUnitVectors(UP, this.ropeDirection)
    this.cable.quaternion.copy(this.cableQuaternion)

    if (this.pulling) {
      this.lightDirection.copy(this.aimTarget).sub(this.position).normalize()
      this.currentLightDirection.lerp(this.lightDirection, 0.32).normalize()
    } else {
      this.swingQuaternion.setFromUnitVectors(DOWN, this.ropeDirection)
      this.lightDirection.copy(DOWN).applyQuaternion(this.swingQuaternion).normalize()
      this.currentLightDirection.lerp(this.lightDirection, 0.14).normalize()
    }
    this.lampQuaternion.setFromUnitVectors(DOWN, this.currentLightDirection)
    this.lampRoot.position.copy(this.position)
    this.lampRoot.quaternion.copy(this.lampQuaternion)
    this.ceilingCap.position.copy(this.anchor)
    this.ceilingCap.position.y += 0.08
  }
}

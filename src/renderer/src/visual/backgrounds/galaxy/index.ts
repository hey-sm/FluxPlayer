/*
 * Composition reference: the "Galaxy" particles demo at https://threejsdemos.com/demos/particles/galaxy
 * — a procedural spiral generator (per-star branch angle, radius-proportional spin, power-biased
 * scatter, inner-to-outer color ramp on additively blended points).
 *
 * That page publishes no license, so no upstream code is reused: the generator, GLSL, seeded RNG and
 * viewport fitting below are FluxPlayer's own and follow the Stage contract (shared renderer/ticker,
 * one owned group, everything disposed once). See THIRD_PARTY_NOTICES.md.
 *
 * The reference frames the disc with an orbiting camera; FluxPlayer cannot move the shared background
 * camera, so the disc itself is tilted to the same oblique elevation and the composition stays static
 * apart from one very slow rotation — the 3D lyrics own the foreground.
 */
import * as THREE from 'three'
import { disposeObjectTree } from '../resources'
import type { DynamicBackground } from '../types'

const CAMERA_FOV = 37
const CAMERA_DISTANCE = 13.6
// The tunables mirror the reference demo's live control panel: 80000 stars, radius 20, 2 arms,
// spiral tightness 2.5, randomness 0.535 at power 1, star size 0.01, white core, 0099ff rim.
const STAR_COUNT = 80_000
const BRANCH_COUNT = 2
const SPIN_TURNS = 7.96 // tightness 2.5 over radius 20 = 50rad; tight winding is what blurs the arms
const CORE_BIAS = 1 // uniform radius, so density falls off as 1/r and lights the bulge on its own
const SCATTER_POWER = 1 // uniform scatter: the arms dissolve into a haze instead of staying crisp
const SCATTER_STRENGTH = 0.535
const DISC_FLATTEN = 0.6 // share of the planar scatter applied vertically, keeping a lens not a ball
const TILT = 0.44 // radians of viewing elevation above the disc plane
const INITIAL_SPIN = 0.83 // the disc already reads as a galaxy before update() ever runs
const SPIN_SPEED = 0.018 // rad/s, one revolution ~350s; 0 stops the disc entirely
const CORE_GLOW_SIZE = 0.34 // fraction of the disc radius
const CORE_GLOW_OPACITY = 0.06
const STAR_INTENSITY = 1.05 // global star brightness multiplier
const CORE_DIM = 0.5 // how much the bulge stars are dimmed, 0 = no dimming
const CORE_DIM_RADIUS = 0.26 // share of the disc radius the dimming covers
const CORE_COLOR = '#ffffff'
const EDGE_COLOR = '#0099ff'
const EDGE_ACCENT_MIX = 0.34 // how far the rim leans from the reference blue toward the theme color
const CORE_ACCENT_MIX = 0.05
const STAR_SEED = 0x5eed1a5b

const VERTEX_SHADER = `
attribute float aRadius;
attribute float aSize;
attribute float aSeed;

uniform float uTime;
uniform float uSizeScale;
uniform vec3 uCoreColor;
uniform vec3 uEdgeColor;

varying vec3 vColor;
varying float vIntensity;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float depth = max(0.001, -mvPosition.z);
  float breath = 0.95 + 0.05 * sin(uTime * 0.42 + aSeed * 6.2831853);
  gl_PointSize = clamp(aSize * uSizeScale * breath / depth, 1.0, 42.0);
  vColor = mix(uCoreColor, uEdgeColor, clamp(aRadius, 0.0, 1.0));
  // The bulge is dense enough to blow out on its own, so its stars are dimmed toward the center.
  float coreDim = mix(${(1 - CORE_DIM).toFixed(3)}, 1.0, smoothstep(0.0, ${CORE_DIM_RADIUS.toFixed(3)}, aRadius));
  float rimFade = 1.0 - 0.45 * smoothstep(0.86, 1.0, aRadius);
  vIntensity = breath * ${STAR_INTENSITY.toFixed(3)} * coreDim * rimFade;
}
`

const FRAGMENT_SHADER = `
precision highp float;

varying vec3 vColor;
varying float vIntensity;

void main() {
  float distanceToCenter = length(gl_PointCoord - 0.5) * 2.0;
  if (distanceToCenter > 1.0) discard;
  float falloff = pow(1.0 - distanceToCenter, 2.2);
  float halo = pow(1.0 - distanceToCenter, 6.5) * 0.55;
  gl_FragColor = vec4(vColor * vIntensity * (1.0 + halo), falloff * vIntensity);
  #include <colorspace_fragment>
}
`

/** Mulberry32: the disc is generated once per instance and must look identical on every launch. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Signed offset biased toward zero so arms stay readable instead of blurring into a disc. */
function scatter(random: () => number): number {
  return Math.pow(random(), SCATTER_POWER) * (random() < 0.5 ? -1 : 1)
}

function createGalaxyGeometry(): THREE.BufferGeometry {
  const random = createRandom(STAR_SEED)
  const positions = new Float32Array(STAR_COUNT * 3)
  const radii = new Float32Array(STAR_COUNT)
  const sizes = new Float32Array(STAR_COUNT)
  const seeds = new Float32Array(STAR_COUNT)

  for (let index = 0; index < STAR_COUNT; index += 1) {
    const radius = Math.pow(random(), CORE_BIAS)
    const branchAngle = ((index % BRANCH_COUNT) / BRANCH_COUNT) * Math.PI * 2
    const angle = branchAngle + radius * SPIN_TURNS * Math.PI * 2
    const spread = SCATTER_STRENGTH * radius
    const offset = index * 3
    positions[offset] = Math.cos(angle) * radius + scatter(random) * spread
    positions[offset + 1] = scatter(random) * spread * DISC_FLATTEN
    positions[offset + 2] = Math.sin(angle) * radius + scatter(random) * spread
    radii[index] = radius
    // The reference's size 0.01 against radius 20 is sub-pixel — on our canvas that pins every star
    // to the 1px clamp and the haze never forms, so stars are sized for this DPI instead.
    sizes[index] = (0.006 + random() * 0.008) * (random() < 0.03 ? 2.2 : 1)
    seeds[index] = random()
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
  return geometry
}

function createCoreTexture(): THREE.DataTexture {
  const size = 96
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5) / size - 0.5
      const dy = (y + 0.5) / size - 0.5
      const distance = Math.min(1, Math.hypot(dx, dy) * 2)
      const intensity = Math.pow(1 - distance, 3.1)
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

export class GalaxyBackground implements DynamicBackground {
  readonly group = new THREE.Group()

  private readonly disc = new THREE.Group()
  private readonly material: THREE.ShaderMaterial
  private readonly stars: THREE.Points
  private readonly coreTexture = createCoreTexture()
  private readonly coreMaterial: THREE.MeshBasicMaterial
  private readonly core: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly baseCoreColor = new THREE.Color(CORE_COLOR)
  private readonly baseEdgeColor = new THREE.Color(EDGE_COLOR)
  private readonly accentColor = new THREE.Color(CORE_COLOR)

  private elapsed = 0
  private discRadius = 8
  private disposed = false

  constructor() {
    this.group.name = 'galaxy-background'
    this.group.userData.backgroundEffect = 'galaxy'
    this.group.rotation.x = TILT

    this.disc.name = 'galaxy-disc'
    this.disc.rotation.y = INITIAL_SPIN
    this.group.add(this.disc)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSizeScale: { value: 1 },
        uCoreColor: { value: this.baseCoreColor.clone() },
        uEdgeColor: { value: this.baseEdgeColor.clone() },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this.stars = new THREE.Points(createGalaxyGeometry(), this.material)
    this.stars.name = 'galaxy-stars'
    this.stars.frustumCulled = false
    this.stars.renderOrder = -100
    this.disc.add(this.stars)

    this.coreMaterial = new THREE.MeshBasicMaterial({
      map: this.coreTexture,
      color: this.baseCoreColor.clone(),
      transparent: true,
      opacity: CORE_GLOW_OPACITY,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    })
    this.core = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.coreMaterial)
    this.core.name = 'galaxy-core-glow'
    // The glow lives outside the spinning disc and cancels the tilt so it stays screen-facing.
    this.core.rotation.x = -TILT
    this.core.scale.setScalar(CORE_GLOW_SIZE)
    this.core.frustumCulled = false
    this.core.renderOrder = -101
    this.group.add(this.core)
  }

  setAccentColor(color: string): void {
    if (this.disposed) return
    this.accentColor.set(color)
    const edge = this.material.uniforms.uEdgeColor.value as THREE.Color
    edge.copy(this.baseEdgeColor).lerp(this.accentColor, EDGE_ACCENT_MIX)
    // The bulge keeps its warm cast and only leans slightly toward the theme color.
    this.coreMaterial.color.copy(this.baseCoreColor).lerp(this.accentColor, CORE_ACCENT_MIX)
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    if (this.disposed) return
    const safeWidth = Math.max(1, width)
    const safeHeight = Math.max(1, height)
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV * 0.5)) * CAMERA_DISTANCE
    const visibleWidth = visibleHeight * (safeWidth / safeHeight)
    // Bleed off the sides, stay inside the top edge: the tilted disc is 2R wide and 2R*sin(TILT) tall.
    // Scatter carries stars out to ~1.7 local units, so the fit factor is well under half the frame.
    this.discRadius = Math.min(visibleWidth * 0.4, (visibleHeight * 0.5) / Math.sin(TILT))
    this.group.scale.setScalar(this.discRadius)
    // Sink the bulge below the lyric band so the brightest part never sits behind the text.
    this.group.position.y = -visibleHeight * 0.15
    // Match the built-in points attenuation (size * pixelRatio * height/2 / depth) in world units.
    this.material.uniforms.uSizeScale.value =
      Math.max(0.5, pixelRatio) * safeHeight * 0.5 * this.discRadius
  }

  setPointer(_x: number, _y: number, _active: boolean): void {
    // Deliberately inert: the galaxy is a static composition, so there is no pointer parallax.
  }

  update(deltaTime: number): void {
    if (this.disposed) return
    this.elapsed += Math.max(0, deltaTime)
    this.disc.rotation.y = INITIAL_SPIN + this.elapsed * SPIN_SPEED
    this.material.uniforms.uTime.value = this.elapsed
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.coreTexture.dispose()
    disposeObjectTree(this.group)
    this.disc.clear()
    this.group.clear()
  }
}

/*
 * Shader adapted from React Bits Galaxy at commit 8d1c5fa9.
 * Copyright (c) 2026 David Haz. MIT + Commons Clause; see THIRD_PARTY_NOTICES.md.
 */
import * as THREE from 'three'
import { disposeObjectTree } from '../resources'
import type { DynamicBackground } from '../types'

const VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
precision highp float;
uniform float uTime;
uniform vec3 uResolution;
uniform vec2 uFocal;
uniform vec2 uRotation;
uniform float uStarSpeed;
uniform float uDensity;
uniform float uHueShift;
uniform float uSpeed;
uniform vec2 uMouse;
uniform float uGlowIntensity;
uniform float uSaturation;
uniform bool uMouseRepulsion;
uniform float uTwinkleIntensity;
uniform float uRotationSpeed;
uniform float uRepulsionStrength;
uniform float uMouseActiveFactor;
uniform float uAutoCenterRepulsion;
uniform vec3 uAccentColor;
varying vec2 vUv;

#define NUM_LAYER 4.0
#define STAR_COLOR_CUTOFF 0.2
#define MAT45 mat2(0.7071, -0.7071, 0.7071, 0.7071)
#define PERIOD 3.0

float Hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float tri(float x) { return abs(fract(x) * 2.0 - 1.0); }
float tris(float x) {
  float t = fract(x);
  return 1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0));
}
float trisn(float x) {
  float t = fract(x);
  return 2.0 * (1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0))) - 1.0;
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
float Star(vec2 uv, float flare) {
  float d = length(uv);
  float m = (0.05 * uGlowIntensity) / d;
  float rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * flare * uGlowIntensity;
  uv *= MAT45;
  rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * 0.3 * flare * uGlowIntensity;
  m *= smoothstep(1.0, 0.2, d);
  return m;
}
vec3 StarLayer(vec2 uv) {
  vec3 col = vec3(0.0);
  vec2 gv = fract(uv) - 0.5;
  vec2 id = floor(uv);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 si = id + offset;
      float seed = Hash21(si);
      float size = fract(seed * 345.32);
      float glossLocal = tri(uStarSpeed / (PERIOD * seed + 1.0));
      float flareSize = smoothstep(0.9, 1.0, size) * glossLocal;
      float red = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 1.0)) + STAR_COLOR_CUTOFF;
      float blu = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 3.0)) + STAR_COLOR_CUTOFF;
      float grn = min(red, blu) * seed;
      vec3 base = vec3(red, grn, blu);
      float hue = atan(base.g - base.r, base.b - base.r) / 6.28318 + 0.5;
      hue = fract(hue + uHueShift / 360.0);
      float sat = length(base - vec3(dot(base, vec3(0.299, 0.587, 0.114)))) * uSaturation;
      float val = max(max(base.r, base.g), base.b);
      base = hsv2rgb(vec3(hue, sat, val));
      vec2 pad = vec2(
        tris(seed * 34.0 + uTime * uSpeed / 10.0),
        tris(seed * 38.0 + uTime * uSpeed / 30.0)
      ) - 0.5;
      float star = Star(gv - offset - pad, flareSize);
      float twinkle = trisn(uTime * uSpeed + seed * 6.2831) * 0.5 + 1.0;
      twinkle = mix(1.0, twinkle, uTwinkleIntensity);
      col += star * twinkle * size * base;
    }
  }
  return col;
}
void main() {
  vec2 focalPx = uFocal * uResolution.xy;
  vec2 uv = (vUv * uResolution.xy - focalPx) / uResolution.y;
  vec2 mouseNorm = uMouse - vec2(0.5);
  if (uAutoCenterRepulsion > 0.0) {
    float centerDist = length(uv);
    uv += normalize(uv) * (uAutoCenterRepulsion / (centerDist + 0.1)) * 0.05;
  } else if (uMouseRepulsion) {
    vec2 mousePosUV = (uMouse * uResolution.xy - focalPx) / uResolution.y;
    float mouseDist = length(uv - mousePosUV);
    uv += normalize(uv - mousePosUV) * (uRepulsionStrength / (mouseDist + 0.1)) * 0.05 * uMouseActiveFactor;
  } else {
    uv += mouseNorm * 0.1 * uMouseActiveFactor;
  }
  float autoRotAngle = uTime * uRotationSpeed;
  mat2 autoRot = mat2(cos(autoRotAngle), -sin(autoRotAngle), sin(autoRotAngle), cos(autoRotAngle));
  uv = autoRot * uv;
  uv = mat2(uRotation.x, -uRotation.y, uRotation.y, uRotation.x) * uv;
  vec3 col = vec3(0.0);
  for (float i = 0.0; i < 1.0; i += 1.0 / NUM_LAYER) {
    float depth = fract(i + uStarSpeed * uSpeed);
    float scale = mix(20.0 * uDensity, 0.5 * uDensity, depth);
    float fade = depth * smoothstep(1.0, 0.9, depth);
    col += StarLayer(uv * scale + i * 453.32) * fade;
  }
  gl_FragColor = vec4(col * mix(vec3(1.0), uAccentColor, 0.82), 1.0);
}
`

export class GalaxyBackground implements DynamicBackground {
  readonly group = new THREE.Group()
  private readonly material: THREE.ShaderMaterial
  private readonly targetMouse = new THREE.Vector2(0.5, 0.5)
  private readonly smoothMouse = new THREE.Vector2(0.5, 0.5)
  private targetMouseActive = 0
  private smoothMouseActive = 0
  private elapsed = 0
  private disposed = false

  constructor() {
    this.group.name = 'galaxy-background'
    this.group.userData.backgroundEffect = 'galaxy'
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector3(1, 1, 1) },
        uFocal: { value: new THREE.Vector2(0.5, 0.5) },
        uRotation: { value: new THREE.Vector2(1, 0) },
        uStarSpeed: { value: 0 },
        uDensity: { value: 1 },
        uHueShift: { value: 140 },
        uSpeed: { value: 1 },
        uMouse: { value: this.smoothMouse },
        uGlowIntensity: { value: 0.3 },
        uSaturation: { value: 0 },
        uMouseRepulsion: { value: true },
        uTwinkleIntensity: { value: 0.3 },
        uRotationSpeed: { value: 0.1 },
        uRepulsionStrength: { value: 2 },
        uMouseActiveFactor: { value: 0 },
        uAutoCenterRepulsion: { value: 0 },
        uAccentColor: { value: new THREE.Color('#00f5d4') },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    mesh.name = 'galaxy-fullscreen-quad'
    mesh.frustumCulled = false
    mesh.renderOrder = -100
    this.group.add(mesh)
  }

  setAccentColor(color: string): void {
    const accent = this.material.uniforms.uAccentColor.value as THREE.Color
    accent.set(color)
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    const resolution = this.material.uniforms.uResolution.value as THREE.Vector3
    resolution.set(width * pixelRatio, height * pixelRatio, width / Math.max(height, 1))
  }

  setPointer(x: number, y: number, active: boolean): void {
    this.targetMouse.set(x, 1 - y)
    this.targetMouseActive = active ? 1 : 0
  }

  update(deltaTime: number): void {
    if (this.disposed) return
    const dt = Math.max(0, deltaTime)
    this.elapsed += dt
    const alpha = 1 - Math.exp(-3.1 * dt)
    this.smoothMouse.lerp(this.targetMouse, alpha)
    this.smoothMouseActive += (this.targetMouseActive - this.smoothMouseActive) * alpha
    this.material.uniforms.uTime.value = this.elapsed
    this.material.uniforms.uStarSpeed.value = (this.elapsed * 0.5) / 10
    this.material.uniforms.uMouseActiveFactor.value = this.smoothMouseActive
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    disposeObjectTree(this.group)
    this.group.clear()
  }
}

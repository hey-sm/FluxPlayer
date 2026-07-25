/*
 * Shader adapted from React Bits LightRays at commit 8d1c5fa9.
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

uniform float iTime;
uniform vec2 iResolution;
uniform vec2 rayPos;
uniform vec2 rayDir;
uniform vec3 raysColor;
uniform float raysSpeed;
uniform float lightSpread;
uniform float rayLength;
uniform float pulsating;
uniform float fadeDistance;
uniform float saturation;
uniform vec2 mousePos;
uniform float mouseInfluence;
uniform float noiseAmount;
uniform float distortion;

float noise(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord,
  float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  vec2 dirNorm = normalize(sourceToCoord);
  float cosAngle = dot(dirNorm, rayRefDirection);
  float distortedAngle = cosAngle + distortion * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;
  float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));
  float distanceToSource = length(sourceToCoord);
  float maxDistance = iResolution.x * rayLength;
  float lengthFalloff = clamp((maxDistance - distanceToSource) / maxDistance, 0.0, 1.0);
  float fadeFalloff = clamp(
    (iResolution.x * fadeDistance - distanceToSource) / (iResolution.x * fadeDistance),
    0.5,
    1.0
  );
  float pulse = pulsating > 0.5 ? (0.8 + 0.2 * sin(iTime * speed * 3.0)) : 1.0;
  float baseStrength = clamp(
    (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed)) +
      (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)),
    0.0,
    1.0
  );
  return baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;
}

void main() {
  vec2 coord = vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y);
  vec2 finalRayDir = rayDir;
  if (mouseInfluence > 0.0) {
    vec2 mouseScreenPos = mousePos * iResolution.xy;
    vec2 mouseDirection = normalize(mouseScreenPos - rayPos);
    finalRayDir = normalize(mix(rayDir, mouseDirection, mouseInfluence));
  }

  vec4 rays1 = vec4(1.0) * rayStrength(rayPos, finalRayDir, coord, 36.2214, 21.11349, 1.5 * raysSpeed);
  vec4 rays2 = vec4(1.0) * rayStrength(rayPos, finalRayDir, coord, 22.3991, 18.0234, 1.1 * raysSpeed);
  vec4 color = rays1 * 0.5 + rays2 * 0.4;
  if (noiseAmount > 0.0) {
    float n = noise(coord * 0.01 + iTime * 0.1);
    color.rgb *= 1.0 - noiseAmount + noiseAmount * n;
  }
  float brightness = 1.0 - coord.y / iResolution.y;
  color.r *= 0.1 + brightness * 0.8;
  color.g *= 0.3 + brightness * 0.6;
  color.b *= 0.5 + brightness * 0.5;
  if (saturation != 1.0) {
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(gray), color.rgb, saturation);
  }
  color.rgb *= raysColor;
  gl_FragColor = color;
}
`

export class LightRaysBackground implements DynamicBackground {
  readonly group = new THREE.Group()
  private readonly material: THREE.ShaderMaterial
  private elapsed = 0
  private disposed = false

  constructor() {
    this.group.name = 'light-rays-background'
    this.group.userData.backgroundEffect = 'light-rays'
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector2(1, 1) },
        rayPos: { value: new THREE.Vector2(0.5, -0.2) },
        rayDir: { value: new THREE.Vector2(0, 1) },
        raysColor: { value: new THREE.Color('#ffffff') },
        raysSpeed: { value: 1 },
        lightSpread: { value: 0.5 },
        rayLength: { value: 3 },
        pulsating: { value: 0 },
        fadeDistance: { value: 1 },
        saturation: { value: 1 },
        mousePos: { value: new THREE.Vector2(0.5, 0.5) },
        mouseInfluence: { value: 0.1 },
        noiseAmount: { value: 0 },
        distortion: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    mesh.name = 'light-rays-fullscreen-quad'
    mesh.frustumCulled = false
    mesh.renderOrder = -100
    this.group.add(mesh)
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    const resolution = this.material.uniforms.iResolution.value as THREE.Vector2
    resolution.set(width * pixelRatio, height * pixelRatio)
    const rayPos = this.material.uniforms.rayPos.value as THREE.Vector2
    rayPos.set(resolution.x * 0.5, resolution.y * -0.2)
  }

  setAccentColor(color: string): void {
    const accent = this.material.uniforms.raysColor.value as THREE.Color
    accent.set(color)
  }

  setPointer(x: number, y: number, active: boolean): void {
    const mouse = this.material.uniforms.mousePos.value as THREE.Vector2
    mouse.set(x, y)
    this.material.uniforms.mouseInfluence.value = active ? 0.1 : 0
  }

  update(deltaTime: number): void {
    if (this.disposed) return
    this.elapsed += Math.max(0, deltaTime)
    this.material.uniforms.iTime.value = this.elapsed
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    disposeObjectTree(this.group)
    this.group.clear()
  }
}

/*
 * Shader adapted from "Tileable Water Caustic" by Dave_Hoskins on Shadertoy
 * (https://www.shadertoy.com/view/MdlXz8), which itself builds on the water
 * turbulence effect by joltz0r on GLSL Sandbox.
 *
 * Shadertoy publishes shaders under its Terms of Service, which permit
 * modification and reuse with attribution; the original author comments and
 * upstream links are preserved below. See THIRD_PARTY_NOTICES.md.
 *
 * FluxPlayer wraps the GLSL in the shared full-screen-quad background contract
 * (shared renderer/ticker, one owned group, disposed once). The color palette
 * is kept faithful to the upstream original (teal-blue water + white caustic
 * ridges); the only adaptation is an alpha channel so the quad layers behind the
 * translucent UI instead of the original opaque black canvas.
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

#define TAU 6.28318530718
#define MAX_ITER 5

// Adapted from "Tileable Water Caustic" by Dave_Hoskins
// (https://www.shadertoy.com/view/MdlXz8), building on joltz0r's GLSL Sandbox
// water turbulence effect. Shadertoy ToS permit reuse with attribution.

void main() {
  float time = iTime * .5 + 23.0;
  // uv should be the 0-1 uv of texture...
  vec2 uv = gl_FragCoord.xy / iResolution.xy;

  vec2 p = mod(uv * TAU, TAU) - 250.0;
  vec2 i = vec2(p);
  float c = 1.0;
  float inten = .005;

  for (int n = 0; n < MAX_ITER; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= float(MAX_ITER);
  c = 1.17 - pow(c, 1.4);
  vec3 colour = vec3(pow(abs(c), 8.0));
  colour = clamp(colour + vec3(0.0, 0.35, 0.5), 0.0, 1.0);
  // The upstream original is fully opaque. FluxPlayer layers this behind
  // translucent UI, so a mild alpha falloff keeps the teal water visible
  // without blanking the foreground — bright caustic ridges stay near-opaque.
  float alpha = clamp(pow(abs(c), 4.0) * 0.7 + 0.55, 0.0, 1.0);
  gl_FragColor = vec4(colour, alpha);
}
`

export class CausticBackground implements DynamicBackground {
  readonly group = new THREE.Group()

  private readonly material: THREE.ShaderMaterial
  private elapsed = 0
  private disposed = false

  constructor() {
    this.group.name = 'caustic-background'
    this.group.userData.backgroundEffect = 'caustic'
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    mesh.name = 'caustic-fullscreen-quad'
    mesh.frustumCulled = false
    mesh.renderOrder = -100
    this.group.add(mesh)
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    if (this.disposed) return
    const resolution = this.material.uniforms.iResolution.value as THREE.Vector2
    resolution.set(Math.max(1, width) * Math.max(0.5, pixelRatio), Math.max(1, height) * Math.max(0.5, pixelRatio))
  }

  // The caustic palette is fixed to the upstream original (teal water + white
  // ridges), so it intentionally ignores the theme accent.
  setAccentColor(_color: string): void {}

  setPointer(_x: number, _y: number, _active: boolean): void {
    // The caustic is a procedural texture with no pointer interaction by design.
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

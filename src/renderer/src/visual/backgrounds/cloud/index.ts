/*
 * Shader adapted from the "Strata — Cloud Migration Platform" hero background
 * by ThreeUI (https://github.com/MengTo/threeui), part of the Portal Field
 * collection (https://threeui.com/backgrounds/portal-field/cloud-field).
 *
 * License: MIT. See THIRD_PARTY_NOTICES.md.
 * Copyright (c) MengTo / ThreeUI.
 *
 * FluxPlayer adaptations:
 *   - Ported the raw WebGL1 fragment shader into a Three.js ShaderMaterial
 *     under the shared full-screen-quad background contract (shared
 *     renderer/ticker, one owned group, disposed once).
 *   - The upstream canvas is fully opaque (#050510). FluxPlayer layers this
 *     behind translucent UI, so the night-sky base is kept and a mild alpha
 *     falloff lets the composition read through the foreground instead of
 *     blanking it — the bright meteor/star/mountain ridges stay near-opaque.
 *   - The upstream mouse parallax (u_mouse 0..1) is wired to the background
 *     pointer contract: an inactive pointer parks the parallax at centre and
 *     the smoothed target eases back there on release.
 *   - All landing-page content (nav, hero copy, cards, GSAP reveals) is
 *     dropped — only the background canvas survives, exactly as the upstream
 *     ThreeUI isolator does for this variant.
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
uniform vec2 iMouse;

float hash(float n){ return fract(sin(n)*43758.5453123); }
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }

float noise(float x){
  float i = floor(x);
  float f = fract(x);
  f = f*f*(3.0-2.0*f);
  return mix(hash(i), hash(i+1.0), f);
}

float fbm(float x, float octaves){
  float val = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for(int i = 0; i < 6; i++){
    if(float(i) >= octaves) break;
    val += amp * noise(x * freq);
    freq *= 2.17;
    amp *= 0.48;
  }
  return val;
}

float meteor(vec2 uv, float t){
  float cycle = mod(t * 0.15, 1.0);
  float seed = floor(t * 0.15);
  float h = hash(seed * 7.31);
  float h2 = hash(seed * 13.17);
  if(h > 0.30) return 0.0;
  vec2 start = vec2(0.2 + h2 * 0.6, 0.7 + h * 0.25);
  vec2 dir = normalize(vec2(1.0, -0.6 - h * 0.3));
  float progress = smoothstep(0.0, 0.7, cycle);
  vec2 pos = start + dir * progress * 0.5;
  vec2 toP = uv - pos;
  float along = dot(toP, dir);
  float perp = length(toP - dir * along);
  float trail = smoothstep(0.0, -0.12, along) * smoothstep(-0.18, -0.04, along);
  float core = smoothstep(0.003, 0.0, perp) * trail;
  float glow = smoothstep(0.012, 0.0, perp) * trail * 0.3;
  float fade = smoothstep(0.0, 0.1, cycle) * smoothstep(0.8, 0.55, cycle);
  return (core + glow) * fade;
}

float stars(vec2 uv, float density){
  vec2 cell = floor(uv * density);
  vec2 sub = fract(uv * density);
  float h = hash2(cell);
  float brightness = step(0.975, h);
  float size = 0.025 + h * 0.045;
  float d = length(sub - vec2(hash2(cell + 100.0), hash2(cell + 200.0)));
  float star = brightness * smoothstep(size, 0.0, d);
  star *= 0.5 + 0.5 * sin(iTime * (1.0 + h * 3.0) + h * 6.28);
  return star;
}

void main(){
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;

  vec2 mouse = iMouse * 2.0 - 1.0;

  vec3 skyTop    = vec3(0.015, 0.012, 0.045);
  vec3 skyMid    = vec3(0.035, 0.025, 0.085);
  vec3 skyBottom = vec3(0.065, 0.045, 0.14);

  float skyGrad = uv.y;
  vec3 col = mix(skyBottom, skyMid, smoothstep(0.3, 0.6, skyGrad));
  col = mix(col, skyTop, smoothstep(0.6, 1.0, skyGrad));

  float horizonY = 0.35;
  float horizonGlow = exp(-pow((uv.y - horizonY) * 3.8, 2.0));
  col += vec3(0.15, 0.07, 0.26) * horizonGlow * 0.8;

  float centerGlow = exp(-pow((uv.x - 0.5) * 1.5, 2.0)) * exp(-pow((uv.y - horizonY) * 4.0, 2.0));
  col += vec3(0.14, 0.10, 0.24) * centerGlow * 0.6;

  float starField = stars(uv * vec2(aspect, 1.0), 60.0)
                  + stars(uv * vec2(aspect, 1.0) + 500.0, 100.0) * 0.7
                  + stars(uv * vec2(aspect, 1.0) + 900.0, 160.0) * 0.4;

  float starMask = 1.0;
  float xC, yS, prof, mTop, mtn, rDist, rGlow, rAmb;
  vec3 lC;

  // Layer 0
  lC = vec3(0.14, 0.10, 0.24);
  xC = uv.x * aspect * 1.6 + iTime * 0.006 + mouse.x * 0.010;
  yS = mouse.y * 0.003;
  prof = fbm(xC, 5.0) * 0.10 + fbm(xC * 0.3 + 17.0, 3.0) * 0.07;
  mTop = 0.40 + prof + yS;
  mtn = smoothstep(mTop + 0.003, mTop - 0.001, uv.y);
  rDist = abs(uv.y - mTop);
  rGlow = smoothstep(0.012, 0.0, rDist) * 0.18;
  rAmb = smoothstep(0.04, 0.0, rDist) * 0.06;
  col = mix(col, lC, mtn);
  col += vec3(0.20, 0.10, 0.35) * rGlow;
  col += vec3(0.12, 0.06, 0.22) * rAmb;
  starMask *= (1.0 - mtn);

  // Layer 1
  lC = vec3(0.11, 0.07, 0.19);
  xC = uv.x * aspect * 2.0 + iTime * 0.012 + mouse.x * 0.020;
  yS = mouse.y * 0.006;
  prof = fbm(xC, 5.0) * 0.13 + fbm(xC * 0.3 + 34.0, 3.0) * 0.091;
  mTop = 0.33 + prof + yS;
  mtn = smoothstep(mTop + 0.003, mTop - 0.001, uv.y);
  rDist = abs(uv.y - mTop);
  rGlow = smoothstep(0.012, 0.0, rDist) * 0.15;
  rAmb = smoothstep(0.04, 0.0, rDist) * 0.045;
  col = mix(col, lC, mtn);
  col += vec3(0.20, 0.10, 0.35) * rGlow;
  col += vec3(0.12, 0.06, 0.22) * rAmb;
  starMask *= (1.0 - mtn);

  // Layer 2
  lC = vec3(0.08, 0.05, 0.14);
  xC = uv.x * aspect * 2.6 + iTime * 0.020 + mouse.x * 0.034;
  yS = mouse.y * 0.010;
  prof = fbm(xC, 5.0) * 0.16 + fbm(xC * 0.3 + 51.0, 3.0) * 0.112;
  mTop = 0.26 + prof + yS;
  mtn = smoothstep(mTop + 0.003, mTop - 0.001, uv.y);
  rDist = abs(uv.y - mTop);
  rGlow = smoothstep(0.012, 0.0, rDist) * 0.12;
  rAmb = smoothstep(0.04, 0.0, rDist) * 0.03;
  col = mix(col, lC, mtn);
  col += vec3(0.20, 0.10, 0.35) * rGlow;
  col += vec3(0.12, 0.06, 0.22) * rAmb;
  starMask *= (1.0 - mtn);

  // Layer 3
  lC = vec3(0.05, 0.03, 0.09);
  xC = uv.x * aspect * 3.2 + iTime * 0.030 + mouse.x * 0.050;
  yS = mouse.y * 0.015;
  prof = fbm(xC, 5.0) * 0.14 + fbm(xC * 0.3 + 68.0, 3.0) * 0.098;
  mTop = 0.18 + prof + yS;
  mtn = smoothstep(mTop + 0.003, mTop - 0.001, uv.y);
  rDist = abs(uv.y - mTop);
  rGlow = smoothstep(0.012, 0.0, rDist) * 0.09;
  col = mix(col, lC, mtn);
  col += vec3(0.20, 0.10, 0.35) * rGlow;
  starMask *= (1.0 - mtn);

  // Layer 4
  lC = vec3(0.03, 0.018, 0.055);
  xC = uv.x * aspect * 4.0 + iTime * 0.044 + mouse.x * 0.070;
  yS = mouse.y * 0.021;
  prof = fbm(xC, 5.0) * 0.11 + fbm(xC * 0.3 + 85.0, 3.0) * 0.077;
  mTop = 0.09 + prof + yS;
  mtn = smoothstep(mTop + 0.003, mTop - 0.001, uv.y);
  rDist = abs(uv.y - mTop);
  rGlow = smoothstep(0.012, 0.0, rDist) * 0.06;
  col = mix(col, lC, mtn);
  col += vec3(0.20, 0.10, 0.35) * rGlow;
  starMask *= (1.0 - mtn);

  col += vec3(0.9, 0.8, 1.0) * starField * starMask;
  float met = meteor(uv * vec2(aspect, 1.0), iTime);
  col += vec3(0.8, 0.6, 1.0) * met * starMask;

  float vig = 1.0 - 0.3 * pow(length((uv - 0.5) * vec2(1.1, 1.6)), 2.0);
  col *= vig;

  float haze = exp(-pow((uv.y - 0.33) * 5.0, 2.0)) * 0.05;
  col += vec3(0.15, 0.10, 0.30) * haze;

  col = pow(col, vec3(0.95));

  // The upstream canvas is fully opaque. FluxPlayer layers this behind
  // translucent UI, so a mild alpha falloff keeps the night-sky base visible
  // without blanking the foreground — bright meteor/star/mountain ridges
  // stay near-opaque so the silhouettes read clearly.
  float alpha = clamp(max(max(col.r, col.g), col.b) * 1.4 + 0.55, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`

export class CloudBackground implements DynamicBackground {
  readonly group = new THREE.Group()

  private readonly material: THREE.ShaderMaterial
  private elapsed = 0
  private targetMouse = new THREE.Vector2(0.5, 0.5)
  private currentMouse = new THREE.Vector2(0.5, 0.5)
  private disposed = false

  constructor() {
    this.group.name = 'cloud-background'
    this.group.userData.backgroundEffect = 'cloud'
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector2(1, 1) },
        iMouse: { value: new THREE.Vector2(0.5, 0.5) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    mesh.name = 'cloud-fullscreen-quad'
    mesh.frustumCulled = false
    mesh.renderOrder = -100
    this.group.add(mesh)
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    if (this.disposed) return
    const resolution = this.material.uniforms.iResolution.value as THREE.Vector2
    resolution.set(Math.max(1, width) * Math.max(0.5, pixelRatio), Math.max(1, height) * Math.max(0.5, pixelRatio))
  }

  // The cloud palette is fixed to the upstream night sky (deep indigo + violet
  // horizon + star/meteor accents), so it intentionally ignores the theme accent.
  setAccentColor(_color: string): void {}

  setPointer(x: number, y: number, active: boolean): void {
    if (this.disposed) return
    // An inactive pointer parks the parallax at centre; the smoothed value
    // eases back there on release via update().
    this.targetMouse.set(active ? x : 0.5, active ? y : 0.5)
  }

  update(deltaTime: number): void {
    if (this.disposed) return
    this.elapsed += Math.max(0, deltaTime)
    this.material.uniforms.iTime.value = this.elapsed
    // Ease the mouse parallax toward its target — matches the upstream
    // smx/smy lerp so the mountain layers drift rather than snap.
    const ease = 1 - Math.exp(-4 * Math.max(0, deltaTime))
    this.currentMouse.lerp(this.targetMouse, ease)
    const mouseUniform = this.material.uniforms.iMouse.value as THREE.Vector2
    mouseUniform.copy(this.currentMouse)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    disposeObjectTree(this.group)
    this.group.clear()
  }
}

/*
 * Shader adapted from "Heartfelt" by Martijn Steinrucken (BigWings) on Shadertoy
 * (https://www.shadertoy.com/view/ltffzl).
 *
 * License: Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported
 * License (CC BY-NC-SA 3.0). See THIRD_PARTY_NOTICES.md for full text.
 * Copyright (c) 2017 Martijn Steinrucken. Email: countfrolic@gmail.com
 *
 * FluxPlayer adaptations:
 *   - Ported to Three.js under ShaderMaterial (GLSL ES 1.0 compatible, using
 *     textureLod via the EXT_shader_texture_lod path that three enables).
 *   - The upstream iChannel0 background photo is replaced by a bundled
 *     photographic image (scene.jpg, sourced from Pexels, see
 *     THIRD_PARTY_NOTICES.md) so the rain refraction distorts a real scene.
 *   - All iMouse interaction is removed: time auto-cycles through the heart
 *     story and the rain amount is driven by a slow sine — there is no
 *     click/scrub control, matching the requested no-pointer-interaction mode.
 *   - The two upstream music-stream inputs are dropped (no audio channel).
 *   - Shared full-screen-quad background contract: shared renderer/ticker,
 *     one owned group, disposed once.
 */
import * as THREE from 'three'
import { disposeObjectTree } from '../resources'
import type { DynamicBackground } from '../types'
import sceneImageUrl from './scene.jpg'

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
uniform sampler2D iChannel0;

#define S(a, b, t) smoothstep(a, b, t)
#define HAS_HEART

vec3 N13(float p) {
   vec3 p3 = fract(vec3(p) * vec3(.1031,.11369,.13787));
   p3 += dot(p3, p3.yzx + 19.19);
   return fract(vec3((p3.x + p3.y)*p3.z, (p3.x+p3.z)*p3.y, (p3.y+p3.z)*p3.x));
}

vec4 N14(float t) {
    return fract(sin(t*vec4(123., 1024., 1456., 264.))*vec4(6547., 345., 8799., 1564.));
}
float N(float t) {
    return fract(sin(t*12345.564)*7658.76);
}

float Saw(float b, float t) {
    return S(0., b, t)*S(1., b, t);
}

vec2 DropLayer2(vec2 uv, float t) {
    vec2 UV = uv;
    uv.y += t*0.75;
    vec2 a = vec2(6., 1.);
    vec2 grid = a*2.;
    vec2 id = floor(uv*grid);
    float colShift = N(id.x);
    uv.y += colShift;
    id = floor(uv*grid);
    vec3 n = N13(id.x*35.2+id.y*2376.1);
    vec2 st = fract(uv*grid)-vec2(.5, 0);
    float x = n.x-.5;
    float y = UV.y*20.;
    float wiggle = sin(y+sin(y));
    x += wiggle*(.5-abs(x))*(n.z-.5);
    x *= .7;
    float ti = fract(t+n.z);
    y = (Saw(.85, ti)-.5)*.9+.5;
    vec2 p = vec2(x, y);
    float d = length((st-p)*a.yx);
    float mainDrop = S(.4, .0, d);
    float r = sqrt(S(1., y, st.y));
    float cd = abs(st.x-x);
    float trail = S(.23*r, .15*r*r, cd);
    float trailFront = S(-.02, .02, st.y-y);
    trail *= trailFront*r*r;
    y = UV.y;
    float trail2 = S(.2*r, .0, cd);
    float droplets = max(0., (sin(y*(1.-y)*120.)-st.y))*trail2*trailFront*n.z;
    y = fract(y*10.)+(st.y-.5);
    float dd = length(st-vec2(x, y));
    droplets = S(.3, 0., dd);
    float m = mainDrop+droplets*r*trailFront;
    return vec2(m, trail);
}

float StaticDrops(vec2 uv, float t) {
    uv *= 40.;
    vec2 id = floor(uv);
    uv = fract(uv)-.5;
    vec3 n = N13(id.x*107.45+id.y*3543.654);
    vec2 p = (n.xy-.5)*.7;
    float d = length(uv-p);
    float fade = Saw(.025, fract(t+n.z));
    float c = S(.3, 0., d)*fract(n.z*10.)*fade;
    return c;
}

vec2 Drops(vec2 uv, float t, float l0, float l1, float l2) {
    float s = StaticDrops(uv, t)*l0;
    vec2 m1 = DropLayer2(uv, t)*l1;
    vec2 m2 = DropLayer2(uv*1.85, t)*l2;
    float c = s+m1.x+m2.x;
    c = S(.3, 1., c);
    return vec2(c, max(m1.y*l0, m2.y*l1));
}

void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    vec2 uv = (fragCoord-.5*iResolution.xy) / iResolution.y;
    vec2 UV = fragCoord/iResolution.xy;

    float T = mod(iTime, 102.0);
    float t = T*.2;

    float rainAmount = sin(T*.05)*.3+.7;
    float maxBlur = mix(3., 6., rainAmount);
    float minBlur = 2.;
    float story = 0.;
    float heart = 0.;

    story = S(0., 70., T);
    t = min(1., T/70.);
    t = 1.-t;
    t = (1.-t*t)*70.;
    float zoom = mix(.3, 1.2, story);
    uv *= zoom;
    minBlur = 4.+S(.5, 1., story)*3.;
    maxBlur = 6.+S(.5, 1., story)*1.5;

    vec2 hv = uv-vec2(.0, -.1);
    hv.x *= .5;
    float s = S(110., 70., T);
    hv.y -= sqrt(abs(hv.x))*.5*s;
    heart = length(hv);
    heart = S(.4*s, .2*s, heart)*s;
    rainAmount = heart;
    maxBlur -= heart;
    uv *= 1.5;
    t *= .25;

    UV = (UV-.5)*(.9+zoom*.1)+.5;

    float staticDrops = S(-.5, 1., rainAmount)*2.;
    float layer1 = S(.25, .75, rainAmount);
    float layer2 = S(.0, .5, rainAmount);

    vec2 c = Drops(uv, t, staticDrops, layer1, layer2);
    // Expensive normals: sample neighbours to get the droplet normal.
    vec2 e = vec2(.001, 0.);
    float cx = Drops(uv+e, t, staticDrops, layer1, layer2).x;
    float cy = Drops(uv+e.yx, t, staticDrops, layer1, layer2).x;
    vec2 n = vec2(cx-c.x, cy-c.x);

    n *= 1.-S(60., 85., T);
    c.y *= 1.-S(80., 100., T)*.8;

    float focus = mix(maxBlur-c.y, minBlur, S(.1, .2, c.x));
    vec3 col = textureLod(iChannel0, UV+n, focus).rgb;

    t = (T+3.)*.5;
    float colFade = sin(t*.2)*.5+.5+story;
    col *= mix(vec3(1.), vec3(.8, .9, 1.3), colFade);
    float fade = S(0., 10., T);
    float lightning = sin(t*sin(t*10.));
    lightning *= pow(max(0., sin(t+sin(t))), 10.);
    col *= 1.+lightning*fade*mix(1., .1, story*story);
    col *= 1.-dot(UV-=.5, UV);

    col = mix(pow(col, vec3(1.2)), col, heart);
    fade *= S(102., 97., T);
    col *= fade;

    gl_FragColor = vec4(col, 1.0);
}
`

/**
 * Load the bundled photographic scene as iChannel0. The image (scene.jpg) is a
 * real photo so the rain refraction distorts a recognisable scene, not a
 * procedural placeholder. textureLod needs mipmaps for the depth-of-field blur,
 * so the texture is generated with a mipmap chain.
 *
 * Shadertoy operates directly on raw texture bytes (no sRGB decode/encode).
 * Setting LinearSRGBColorSpace tells three.js to pass the pixels through
 * unconverted, so the shader's color math matches the upstream appearance
 * instead of being shifted into linear space.
 */
function createSceneTexture(): THREE.Texture {
  const texture = new THREE.TextureLoader().load(sceneImageUrl)
  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

export class RainBackground implements DynamicBackground {
  readonly group = new THREE.Group()

  private readonly material: THREE.ShaderMaterial
  private readonly sceneTexture = createSceneTexture()
  private elapsed = 0
  private disposed = false

  constructor() {
    this.group.name = 'rain-background'
    this.group.userData.backgroundEffect = 'rain'
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector2(1, 1) },
        iChannel0: { value: this.sceneTexture },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    mesh.name = 'rain-fullscreen-quad'
    mesh.frustumCulled = false
    mesh.renderOrder = -100
    this.group.add(mesh)
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    if (this.disposed) return
    const resolution = this.material.uniforms.iResolution.value as THREE.Vector2
    resolution.set(Math.max(1, width) * Math.max(0.5, pixelRatio), Math.max(1, height) * Math.max(0.5, pixelRatio))
  }

  // The rain composition is fixed (auto-cycling heart story), so it intentionally
  // ignores the theme accent — matching the requested no-pointer-interaction mode.
  setAccentColor(_color: string): void {}

  setPointer(_x: number, _y: number, _active: boolean): void {
    // Deliberately inert: no click/scrub control, the story auto-cycles.
  }

  update(deltaTime: number): void {
    if (this.disposed) return
    this.elapsed += Math.max(0, deltaTime)
    this.material.uniforms.iTime.value = this.elapsed
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.sceneTexture.dispose()
    disposeObjectTree(this.group)
    this.group.clear()
  }
}

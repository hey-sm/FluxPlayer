export const CINEMATIC_FOG_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vDepth = worldPosition.z;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

export const CINEMATIC_FOG_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vDepth;

  float hash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);
    return mix(
      mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), local.x),
      local.y
    );
  }

  void main() {
    vec2 centered = vUv - 0.5;
    float edge = smoothstep(0.54, 0.08, length(centered * vec2(0.72, 1.0)));
    float drift = noise(vUv * 3.2 + vec2(uTime * 0.018, vDepth * 0.07));
    float alpha = edge * (0.018 + drift * 0.026 + uEnergy * 0.018);
    gl_FragColor = vec4(uColor, alpha);
  }
`

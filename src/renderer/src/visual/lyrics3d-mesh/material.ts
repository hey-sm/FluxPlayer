import * as THREE from 'three'

export interface LyricsMaterialHandle {
  material: THREE.MeshStandardMaterial
  setHighlight(progress: number, activity: number, color: THREE.Color): void
}

export function createLyricsMaterial(color: THREE.ColorRepresentation): LyricsMaterialHandle {
  const highlightProgress = { value: 0 }
  const highlightActivity = { value: 0 }
  const highlightColor = { value: new THREE.Color(color) }
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0,
    metalness: 0.04,
    roughness: 0.48,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
  })

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uHighlightProgress: highlightProgress,
      uHighlightActivity: highlightActivity,
      uHighlightColor: highlightColor,
    })
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec3 glyphCenter;
         attribute float glyphIndex;
         varying float vLyricHighlightCoordinate;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float lyricGlyphX = clamp((position.x - glyphCenter.x) + 0.5, 0.0, 1.0);
         vLyricHighlightCoordinate = glyphIndex + lyricGlyphX;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying float vLyricHighlightCoordinate;
         uniform float uHighlightProgress;
         uniform float uHighlightActivity;
         uniform vec3 uHighlightColor;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float lyricFill = smoothstep(
           vLyricHighlightCoordinate,
           vLyricHighlightCoordinate + 0.12,
           uHighlightProgress
         ) * uHighlightActivity;
         float lyricBeam = (1.0 - smoothstep(
           0.025,
           0.17,
           abs(uHighlightProgress - vLyricHighlightCoordinate)
         )) * uHighlightActivity;
         diffuseColor.rgb = mix(diffuseColor.rgb, uHighlightColor, lyricFill * 0.82);
         diffuseColor.rgb += uHighlightColor * lyricBeam * 0.42;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += uHighlightColor * lyricBeam * 0.32;`,
      )
  }

  return {
    material,
    setHighlight: (progress, activity, colorValue) => {
      highlightProgress.value = Math.max(0, progress)
      highlightActivity.value = THREE.MathUtils.clamp(activity, 0, 1)
      highlightColor.value.copy(colorValue)
    },
  }
}

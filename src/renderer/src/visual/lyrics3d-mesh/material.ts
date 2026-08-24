import * as THREE from 'three'

export interface LyricsMaterialHandle {
  material: THREE.MeshStandardMaterial
  setHighlight(progress: number, activity: number, color: THREE.Color): void
  setWeight(weight: number): void
  /** 逐字浮现：progress 0→1 推进整句，amount 是位移幅度（em，0 = 关闭），span 为字数 */
  setCascade(progress: number, amount: number, span: number): void
}

export function createLyricsMaterial(color: THREE.ColorRepresentation): LyricsMaterialHandle {
  const highlightProgress = { value: 0 }
  const highlightActivity = { value: 0 }
  const highlightColor = { value: new THREE.Color(color) }
  const fontWeight = { value: 0 }
  const cascadeProgress = { value: 1 }
  const cascadeAmount = { value: 0 }
  const cascadeSpan = { value: 1 }
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0,
    metalness: 0.04,
    roughness: 0.48,
    transparent: true,
    // 半透明 + 写深度会让正在淡出的旧句把新句"挖掉"，看起来就是残影。
    // 深度写入改由图层按行的实际不透明度逐帧决定（只有完全不透明的当前句才写）。
    depthWrite: false,
    side: THREE.FrontSide,
  })

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uHighlightProgress: highlightProgress,
      uHighlightActivity: highlightActivity,
      uHighlightColor: highlightColor,
      uFontWeight: fontWeight,
      uCascadeProgress: cascadeProgress,
      uCascadeAmount: cascadeAmount,
      uCascadeSpan: cascadeSpan,
    })
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uFontWeight;
         uniform float uCascadeProgress;
         uniform float uCascadeAmount;
         uniform float uCascadeSpan;
         attribute vec3 glyphCenter;
         attribute float glyphIndex;
         varying float vLyricHighlightCoordinate;
         varying float vGlyphAppear;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float lyricGlyphX = clamp((position.x - glyphCenter.x) + 0.5, 0.0, 1.0);
         vLyricHighlightCoordinate = glyphIndex + lyricGlyphX;
         // 每个字按 glyphIndex 错开一半的时间窗，最后一个字正好在 progress=1 落位
         float lyricGlyphDelay = (glyphIndex / uCascadeSpan) * 0.5;
         float lyricAppear = clamp((uCascadeProgress - lyricGlyphDelay) / 0.5, 0.0, 1.0);
         lyricAppear = 1.0 - pow(1.0 - lyricAppear, 3.0);
         float lyricCascadeOn = step(0.0001, uCascadeAmount);
         vGlyphAppear = mix(1.0, lyricAppear, lyricCascadeOn);
         transformed.y -= (1.0 - lyricAppear) * uCascadeAmount;
         transformed += normal * uFontWeight;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying float vLyricHighlightCoordinate;
         varying float vGlyphAppear;
         uniform float uHighlightProgress;
         uniform float uHighlightActivity;
         uniform vec3 uHighlightColor;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         diffuseColor.a *= vGlyphAppear;
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
         diffuseColor.rgb = mix(diffuseColor.rgb, uHighlightColor, lyricFill * 0.95);
         diffuseColor.rgb += uHighlightColor * lyricBeam * 0.55;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += uHighlightColor * lyricBeam * 0.45 * vGlyphAppear;`,
      )
  }

  return {
    material,
    setHighlight: (progress, activity, colorValue) => {
      highlightProgress.value = Math.max(0, progress)
      highlightActivity.value = THREE.MathUtils.clamp(activity, 0, 1)
      highlightColor.value.copy(colorValue)
    },
    setWeight: (weight) => {
      fontWeight.value = THREE.MathUtils.clamp(weight, 0, 0.03)
    },
    setCascade: (progress, amount, span) => {
      cascadeProgress.value = THREE.MathUtils.clamp(progress, 0, 1)
      cascadeAmount.value = Math.max(0, amount)
      cascadeSpan.value = Math.max(1, span)
    },
  }
}

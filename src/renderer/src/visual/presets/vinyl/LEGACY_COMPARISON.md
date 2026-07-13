# VINYL legacy comparison

- Legacy source: `public/index.html`.
- Shader ABI: `uPreset = 4`; the VINYL vertex-shader branch starts at legacy lines `6069-6073` (`Preset 4: VINYL RECORD`, `uPreset < 4.5`).
- Metadata: `唱片` / `唱片 · 圆形封面`, from `presetMeta` at legacy line `20089`.
- Camera baseline: radius `6.5`, phi `0.04`, theta `0.0`, from the `p === 4` branch in `setPreset()` at legacy line `21278` (with baseline theta resolved to `0.0` at line `21282`).
- Transition: VINYL uses the `newVisual` non-wallpaper branch in `triggerPresetParticleTransition()` and `tickPresetTransition()` (legacy lines `21225-21256`): duration `0.24`, initial scatter `0.024`, initial burst `0.15`, camera punch `0.12`, peak scatter `0.026`, peak burst `0.12`, and point-scale boost `0.048`.
- 仅机械迁移未优化：本模块只迁移 metadata、camera 和 transition 数值，不修改 shader 数学、uniform 或动画行为。

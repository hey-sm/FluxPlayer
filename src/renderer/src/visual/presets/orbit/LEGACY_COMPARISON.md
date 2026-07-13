# ORBIT legacy comparison

- Shader ABI: `uPreset = 2`.
- Legacy metadata: `星球 · 雕塑感` (`public/index.html`, `presetMeta`).
- Camera baseline: radius `7.0`, phi `0.15`, theta `0.0` (`setPreset`).
- Transition: classic branch, duration `0.24s`, initial scatter `0.12`, peak scatter `0.16`, burst `0.15`, point boost `0.048`.
- Shader source remains byte-identical and is verified by `tests/unit/visual-contract.test.ts`.
- Migration scope: metadata/camera/transition registration only; shader math, uniforms and animation constants were not optimized.
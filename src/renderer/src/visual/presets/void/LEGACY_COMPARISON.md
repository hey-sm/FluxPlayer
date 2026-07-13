# VOID legacy comparison

- Legacy source: `public/index.html`, specifically `presetMeta`, `setPreset()`, `triggerPresetParticleTransition()`, `tickPresetTransition()`, and the vertex shader `uPreset = 3` VOID branch.
- Shader ABI: `uPreset = 3`; this numeric ID is fixed and must not be reordered. The contract name remains `VOID`.
- Legacy metadata: `虚空` / `无粒子 · 自定义背景` (`presetMeta`).
- Camera baseline: radius `8.0`, phi `0.05`, theta `0.0` (`setPreset()`).
- Transition: classic branch, duration `0.24s`, initial scatter `0.12`, initial burst `0.15`, camera punch `0.12`, peak scatter `0.16`, peak burst `0.15`, and point-scale boost `0.048`.
- Shader hash protection: `tests/unit/visual-contract.test.ts` compares SHA-256 hashes of the migrated shader strings with the authoritative legacy strings, preserving the VOID branch byte-for-byte.
- Migration boundary: this preset declares metadata, camera, and transition values only. The legacy shader branch keeps particles hidden by collapsing their positions, setting alpha and color to zero, and disabling ripple amplitude; no shader code is copied or optimized here.
- “无粒子 / 自定义背景” is a boundary, not new behavior: VOID does not render particles and this definition does not create, select, or manage a custom background. Background ownership remains outside this preset module.

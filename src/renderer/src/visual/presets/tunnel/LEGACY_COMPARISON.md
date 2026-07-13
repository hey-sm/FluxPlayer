# TUNNEL legacy comparison

- Legacy source: `public/index.html`, specifically `presetMeta`, `setPreset()`, `triggerPresetParticleTransition()`, `tickPresetTransition()`, and the vertex shader `uPreset = 1` TUNNEL branch.
- Shader ABI: `uPreset = 1`; this numeric ID is fixed and must not be reordered.
- Legacy metadata: `滚筒` / `隧道 · 沉浸感` (`presetMeta`). The contract name remains `TUNNEL`.
- Camera baseline: radius `6.2`, phi `0.03`, theta `0.0` (`setPreset()`).
- Transition: classic branch, duration `0.24s`, initial scatter `0.12`, initial burst `0.15`, camera punch `0.12`, peak scatter `0.16`, peak burst `0.15`, and point-scale boost `0.048`.
- Shader hash protection: `tests/unit/visual-contract.test.ts` compares SHA-256 hashes of the migrated shader strings with the authoritative legacy strings, preserving the TUNNEL branch byte-for-byte.
- Migration boundary: metadata, camera, and transition declaration only. Shader math, uniforms, spin/flow timing, audio response, color sampling, depth fade, and all other animation constants remain unchanged; no shader was copied or optimized here.

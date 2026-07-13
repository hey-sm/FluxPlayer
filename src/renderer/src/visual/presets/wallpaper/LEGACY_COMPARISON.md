# WALLPAPER legacy comparison

- 旧来源：根目录 `public/index.html` 的 `presetMeta[5]`、`setPreset()`、`triggerPresetParticleTransition()` / `tickPresetTransition()`，以及顶点 shader 的 `uPreset = 5` WALLPAPER 分支。
- Shader ABI：`uPreset = 5`，名称固定为 `WALLPAPER`，不得重排或改号。
- 旧中文元数据：名称 `星河`，描述 `壁纸粒子 · 音乐律动`（`presetMeta[5]`）。
- 相机基线：radius `9.4`、phi `0.34`、theta `-0.52`（`setPreset()`）。
- Transition：duration `0.30s`、initial scatter `0.008`、initial burst `0.05`、camera punch `0.04`、peak scatter `0.008`、peak burst `0.045`、point-scale boost `0.016`（`triggerPresetParticleTransition()` / `tickPresetTransition()` 的 WALLPAPER 分支）。
- 迁移边界：仅登记 metadata、camera 与 transition；shader 数学、uniform、音乐响应和动画常量均保持旧实现，**仅机械迁移未优化**。

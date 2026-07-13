# SILK legacy comparison

- 旧来源：根目录 `public/index.html` 的 `presetMeta[0]`、`setPreset()`、`triggerPresetParticleTransition()` / `tickPresetTransition()`，以及顶点 shader 的 `uPreset < 0.5` 分支。
- Shader ABI：`uPreset = 0`，名称固定为 `SILK`，不得重排或改号。
- 旧中文元数据：名称 `emily专辑封面`，描述 `封面粒子 · 快速入场`。
- 相机基线：radius `6.6`、phi `0.08`、theta `0.0`。
- Transition：经典分支，duration `0.24s`、initial scatter `0.12`、initial burst `0.15`、camera punch `0.12`、peak scatter `0.16`、peak burst `0.15`、point-scale boost `0.048`。
- Shader 未复制或优化；`tests/unit/visual-contract.test.ts` 通过 SHA-256 对照旧权威来源，保护 shader 字符串及 ABI。
- 交互边界未更改：SILK 专属鼠标位移、twist、深度图、涟漪、预设卡片切换反馈与相机保留/静默/保存选项仍由既有 shader、stage 和调用层负责。
- 参数边界未更改：本文件只机械登记元数据、相机和 transition；不新增 uniform、参数默认值、钳制规则、动画常量或任何运行时行为。

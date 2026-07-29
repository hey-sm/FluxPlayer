# 3D 歌词渲染修复 + 多语言系统字体方案

> 状态：待实施
> 关联模块：`src/renderer/src/visual/lyrics3d-mesh/*`、`src/main/protocols/*`
> 目标平台：Windows 优先（与 `build:win` / DPAPI 一致）

## 一、要解决的问题

### 问题 1：复杂汉字渲染残缺

截图中激活行「在云端的距离 你更靠近」里的 **端、离、距、去** 等字被渲染成断裂的横条 / 碎片，而简单字形正常。这不是随机丢字，而是特定「稠密、含多个自相交轮廓」的字形被破坏。

**根因**：当前捆绑的 `NotoSansSC-VF.ttf` 是**可变字体（variable font）**。`three-text` 在三角化时按如下规则决定是否做 overlap 去除：

```js
// node_modules/three-text/three/index.cjs
const shouldRemoveOverlaps = options.removeOverlaps ?? this.loadedFont.isVariable ?? false
```

因为字体是可变的，`removeOverlaps` 默认变为 `true`，走 libtess 的**两趟式**流程（先 boundary 提取，再三角化）。这条两趟路径在处理 CJK 复杂自相交轮廓时会产生错误三角形——正是截图里的横条伪影。叠加我们传入的 `fontVariations: { wght: 650 }`（权重插值会进一步加剧自相交），问题被放大。

### 问题 2：不支持其它语言 + 想用系统字体

- `NotoSansSC-VF.ttf`（约 17MB）只覆盖简体中文 + 基础拉丁，**没有**日文假名、韩文谚文等。
- `three-text` **每次 `Text.create` 只用一个字体、无 fallback 机制**，所以捆绑字体之外的文字会渲染成豆腐块（tofu）。
- 需求是**改用系统字体、不再自带字体文件**。

**关键结论**：两个问题可用同一套方案解决——放弃单一可变字体，改为从主进程按语种提供**静态（static）系统字体**。静态字体 `isVariable=false` → 走单趟三角化 → 残缺消失；按脚本选字体 → 天然多语言。

## 二、达成目标（验收标准）

1. 激活行与非激活行中的复杂汉字（端、离、距、去、靠 等）**完整无残缺**。
2. 中 / 英 / 日 / 韩四种脚本的歌词行都能正确成形显示，不出现豆腐块。
3. 应用**不再捆绑任何字体文件**；字体字节由主进程从系统字体目录读取并经受控协议下发。
4. 安全边界不破坏：新协议只读、走固定 allowlist、无路径穿越、CSP 合规、renderer 保持沙箱无凭据。
5. 单一脚本缺失（如某系统无某语种字体）时**优雅降级**：该行跳过而非整层崩溃。
6. `pnpm typecheck`（node + web 两套）、`pnpm lint`、`pnpm test` 全绿；`pnpm build` 后人工核验渲染正确。

## 三、架构决策（已确认）

| 决策点                        | 选择                                                                |
| ----------------------------- | ------------------------------------------------------------------- |
| renderer 如何拿到系统字体字节 | 新增 `flux-font://` 协议（主进程读文件，renderer 沙箱经协议 fetch） |
| 支持哪些脚本的专用字体        | 拉丁 + 中文 + 日文 + 韩文                                           |
| 是否保留捆绑字体做兜底        | 否，删除 17MB 捆绑，纯系统字体                                      |

## 四、实施步骤

### 步骤 1：主进程 —— 新增 `flux-font://` 只读协议

**`src/main/protocols/constants.ts`**

- 新增 `export const FONT_SCHEME = 'flux-font'`。
- 在 `PRODUCTION_CSP` 的 `connect-src` 追加 `flux-font:`。
- 同步更新 `src/renderer/index.html` 里的 `<meta>` CSP（dev 环境用）。

**新建 `src/main/protocols/fonts.ts`**

- 固定「逻辑键 → 候选文件」映射（**不接受任意路径，杜绝穿越**），基于 `%SystemRoot%\Fonts`：

  | 逻辑键  | 候选（按序）                                 | 说明                    |
  | ------- | -------------------------------------------- | ----------------------- |
  | `latin` | `segoeuib.ttf`                               | 纯 TTF，Segoe UI Bold   |
  | `sc`    | `simhei.ttf` → `msyhbd.ttc`(face0)           | 中文黑体 / 微软雅黑粗体 |
  | `jp`    | `YuGothB.ttc`(face0) → `msgothic.ttc`(face0) | 游ゴシック / MS Gothic  |
  | `kr`    | `malgunbd.ttf`                               | Malgun Gothic Bold      |

- **`.ttc` 处理**：`three-text` 的 FontLoader 只接受 sfnt 签名 `0x00010000`(TrueType) 与 `OTTO`(CFF)，**会拒绝 `ttcf` 集合**。因此对 `.ttc` 候选，主进程需先用纯 TS 函数 `extractTtcFace(buffer, index)` 抽出单 face：读取 `ttcf` 头 → 取第 N 个 face 的 table directory → 重新拼装为独立 sfnt（重算表偏移、拷贝共享表数据、修正 `head.checkSumAdjustment`）。仅对 `.ttc` 候选调用。
- **缓存**：按逻辑键在内存缓存已解析的 face 字节，避免重复读盘 / 抽取。
- **`handleFontRequest`**：仅 `GET/HEAD`；URL 必须为 `flux-font://face/<key>` 且 `<key>` 在 allowlist；命中返回 `font/ttf`（或 `font/otf`）+ `Access-Control-Allow-Origin: flux://app` + `Cross-Origin-Resource-Policy: cross-origin` + 长缓存；未知键 / 文件缺失返回 404。

**`src/main/protocols/index.ts`**

- 在 `registerSchemesAsPrivileged` 注册 `flux-font`（`standard/secure/supportFetchAPI/stream`）。
- 新增 `protocol.handle(FONT_SCHEME, handleFontRequest)`。

### 步骤 2：渲染进程 —— 按行脚本识别 + 选字体

**`src/renderer/src/visual/lyrics3d-mesh/harfbuzz.ts`**

- 移除 `FONT_URL` 与 Noto 相关逻辑；`ensureHarfBuzz()` 只负责加载 wasm + `Text.init()`。
- 新增 `fetchFace(key)`：按需 `fetch('flux-font://face/<key>')`，每个键的 `ArrayBuffer` 只取一次并缓存。

**新建 `src/renderer/src/visual/lyrics3d-mesh/fonts.ts`**

- `resolveFontKey(text)`（纯函数、可单测、不碰 DOM）：
  - 含假名（Hiragana/Katakana）→ `jp`
  - 含谚文（Hangul）→ `kr`
  - 含汉字（Han）→ `sc`
  - 其它 → `latin`

**`src/renderer/src/visual/lyrics3d-mesh/index.ts`**

- `resolveGeometry(text)` → `resolveGeometry(text, fontKey)`；几何缓存键改为 `${fontKey}\n${text}`。
- `reconcileWindow` 中：每行先算 `fontKey`，`await fetchFace(fontKey)`，把该 face 传给 `Text.create`。
- **移除** `fontVariations: { wght: 650 }`（改用静态粗体面）。
- **显式传** `removeOverlaps: false` 作为双保险，确保永远走单趟三角化。
- 用「按键记录 fontError 的 Set」代替单一 `fontError` 布尔——某语种字体缺失只跳过该行，不禁用整层。

### 步骤 3：移除捆绑字体

- 删除 `src/renderer/public/fonts/NotoSansSC-VF.ttf` 与 `NotoSansSC-LICENSE.txt`（及 `out/` 内副本）。
- 更新 `THIRD_PARTY_NOTICES.md`：移除 Noto Sans SC 条目。
- 检查并更新 electron-builder 的 `files` / asar 相关字体引用（如有）。

### 步骤 4：测试

- **单测**
  - `resolveFontKey`：SC / JP 假名 / JP 汉字 / KR / 拉丁 / 混排 各用例。
  - `flux-font` URL 校验：allowlist、非法键、路径穿越、非 GET/HEAD 方法。
  - `extractTtcFace`：产出可解析的单 face sfnt（签名 `0x00010000`、table directory 可解析）。
- **e2e / 边界**：如需，将 `flux-font://` 加入 e2e 放行路径；在非 Windows CI 上系统字体不存在，解析器降级为 404、该层跳过而非崩溃。

## 五、验证清单

```bash
pnpm typecheck   # node + web 两套 tsconfig
pnpm lint        # oxlint
pnpm test        # vitest
pnpm build       # 三进程构建
```

构建后人工核验：

1. 复杂汉字（端 / 离 / 距 / 去）渲染完整。
2. 一段日文（含假名）与一段韩文歌词行正确成形。
3. 中英混排、汉字与拉丁同行显示正常。

## 六、权衡与风险

- **Windows 优先**：候选清单针对 Windows 系统字体（与 `build:win`、DPAPI 焦点一致）。macOS/Linux 的映射可后续追加；由于选择「纯系统字体、无兜底」，这些平台若缺对应字体会显示豆腐块——这是既定取舍。
- **TTC 抽取**是唯一有难度的点，已隔离在主进程并有单测覆盖。
- **混排行取单一主字体**：CJK / JP / KR 字体都含拉丁字形，故「汉字 + 拉丁」「日文 + 拉丁」等混排行不受影响。
- **无 fallback 链**：单次 `Text.create` 只用一个字体，极端多脚本混排（同一行同时含日文假名与韩文谚文）会按主字体渲染，少数字符可能缺形。歌词场景中此情况罕见，暂不处理。

## 七、涉及文件汇总

**新增**

- `src/main/protocols/fonts.ts`
- `src/renderer/src/visual/lyrics3d-mesh/fonts.ts`
- 对应单测文件

**修改**

- `src/main/protocols/constants.ts`
- `src/main/protocols/index.ts`
- `src/renderer/index.html`（CSP）
- `src/renderer/src/visual/lyrics3d-mesh/harfbuzz.ts`
- `src/renderer/src/visual/lyrics3d-mesh/index.ts`
- `THIRD_PARTY_NOTICES.md`
- electron-builder 配置（如有字体引用）

**删除**

- `src/renderer/public/fonts/NotoSansSC-VF.ttf`
- `src/renderer/public/fonts/NotoSansSC-LICENSE.txt`

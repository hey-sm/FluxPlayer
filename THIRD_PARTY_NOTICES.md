# 第三方声明 · Third-Party Notices

FluxPlayer 的原创代码采用 [MIT License](LICENSE) 发布。本文件声明项目中改编自他人的源码、随安装包分发的第三方依赖，以及它们各自的许可证。

**两条对本项目有实际约束力的条款，请先读：**

1. **FluxPlayer 不得被出售。** 项目改编了 React Bits 的代码，其许可为 `MIT + Commons Clause License Condition v1.0`。Commons Clause 明确禁止销售软件本身，以及以提供该软件为主要内容的付费服务。
2. **FluxPlayer 不得对用户收取访问 GSAP 驱动内容的费用。** 项目依赖 GSAP，其许可为 GreenSock Standard "no charge" License，该许可仅覆盖终端用户无需付费即可访问的场景。若将来对 FluxPlayer 收费，须另行购买 Club GSAP 商业许可。

FluxPlayer 目前免费且开源，两条均满足。

---

## 一、改编的源码

以下代码基于他人作品改写并随本项目源码分发。每个文件头部都保留了出处注释与上游 commit。

### React Bits — MIT + Commons Clause License Condition v1.0

- 上游：<https://github.com/DavidHDev/react-bits>，commit `8d1c5fa9`
- 版权：Copyright (c) 2026 David Haz
- 本项目中的位置：
  - `src/renderer/src/components/react-bits/AnimatedContent.tsx`
  - `src/renderer/src/components/react-bits/AnimatedList.tsx`
  - `src/renderer/src/components/react-bits/SnapshotAnimatedContent.tsx`

许可为 MIT 许可证附加 Commons Clause 条件。MIT 全文见本文件第五节；Commons Clause 全文如下：

```
"Commons Clause" License Condition v1.0

The Software is provided to you by the Licensor under the License, as defined
below, subject to the following condition.

Without limiting other conditions in the License, the grant of rights under the
License will not include, and the License does not grant to you, the right to
Sell the Software.

For purposes of the foregoing, "Sell" means practicing any or all of the rights
granted to you under the License to provide to third parties, for a fee or other
consideration (including without limitation fees for hosting or consulting/
support services related to the Software), a product or service whose value
derives, entirely or substantially, from the functionality of the Software. Any
license notice or attribution required by the License must also include this
Commons Clause License Condition notice.
```

### HTML-Light-Demo — MIT License

- 上游：<https://github.com/jinruozai/HTML-Light-Demo>，commit `0a0bd3ba53194fff68db78654fc6857ab3faee29`
- 版权：Copyright (c) 2026 Gooooo
- 原始概念与美术方向由上游致谢 <https://x.com/kaolti>
- 本项目中的位置：`src/renderer/src/visual/backgrounds/html-light/index.ts`

FluxPlayer 保留了 HTML-Light-Demo 的灯具几何、灯光装配和受约束的 Verlet 摆动，替换了原 HTMLTexture 页面为自有的程序化表面，以便复用共享的 renderer、ticker 与可访问的 DOM UI。许可证全文见第五节 MIT License。

### Tileable Water Caustic — Shadertoy 服务条款

- 上游：Shadertoy 作品 "Tileable Water Caustic"（作者 Dave_Hoskins），<https://www.shadertoy.com/view/MdlXz8>；该作本身改编自 joltz0r 在 GLSL Sandbox 的水面湍流效果。
- 许可：Shadertoy 服务条款，允许在保留出处与署名的前提下修改和复用。
- 本项目中的位置：`src/renderer/src/visual/backgrounds/caustic/index.ts`（fragment shader 部分）

FluxPlayer 保留了原作的算法与配色（迭代相位扰动累加 + 反距离叠加 + 幂曲线强化焦散纹路，青蓝水底 + 白色焦散脊），仅按共享全屏 quad 背景契约封装（共用 renderer/ticker、单一 owned group、一次性释放），并加了一层 alpha 通道以便叠在半透明 UI 之后而非原作的不透明黑底之上。许可证全文见 Shadertoy 服务条款页。

### Heartfelt（雨窗）— CC BY-NC-SA 3.0

- 上游：Shadertoy 作品 "Heartfelt"（作者 Martijn Steinrucken / BigWings），<https://www.shadertoy.com/view/ltffzl>。
- 许可：Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License（CC BY-NC-SA 3.0）。全文见第五节。
- 本项目中的位置：`src/renderer/src/visual/backgrounds/rain/index.ts`（fragment shader 部分）

FluxPlayer 保留了原作的雨滴/玻璃雾化算法与心形故事动画，做了三处适配：① 移除了全部 iMouse 交互（鼠标 scrub 时间/控制雨量），改为时间自动循环、雨量由慢正弦驱动，符合无点击交互的要求；② 上游 iChannel0 的外链背景照片替换为一张随项目分发的 Pexels 摄影图片（scene.jpg，摄影师 Tom Zhou，Pexels 许可允许免费商用与修改），纹理 colorSpace 设为 LinearSRGBColorSpace 以匹配 Shadertoy 不做 sRGB 解码/编码的行为；③ 舍弃了上游两条音乐流输入。仍按共享全屏 quad 背景契约封装。注意：CC BY-NC-SA 的非商业（NC）与相同共享（SA）条款仅约束本文件中的 shader 代码，不影响 FluxPlayer 其余 MIT 授权代码，也不约束 scene.jpg（后者受 Pexels 许可）。

### ThreeUI — Cloud Field — MIT License

- 上游：ThreeUI "Strata — Cloud Migration Platform" 落地页背景，出自 Portal Field 合集（`cloud-field` 变体），<https://threeui.com/backgrounds/portal-field/cloud-field>；仓库 <https://github.com/MengTo/threeui>。
- 许可：MIT License。ThreeUI 的应用代码、社区组件代码及 ThreeUI 创作的素材均为 MIT 许可。全文见第五节 MIT License。
- 本项目中的位置：`src/renderer/src/visual/backgrounds/cloud/index.ts`（fragment shader 部分）

FluxPlayer 保留了原作的夜空配色与五层视差山峦算法（fbm 轮廓 + 山脊辉光 + 星空密度采样 + 偶发流星），做了四处适配：① 舍弃了上游落地页全部内容（导航、文案、卡片、图片、GSAP/ScrollTrigger/Tailwind/Iconify 等 CDN 依赖）—— ThreeUI 的隔离器在渲染背景时本就只保留 `<canvas id="c">`，移植后 FluxPlayer 不因此多依赖任何上述库；② 将原作不透明黑底改为带 alpha 衰减，以便叠在半透明 UI 之后而非盖住玻璃层，山峦/流星/星空的亮区保持近不透明以保留剪影可读性；③ 将上游 `u_mouse` 鼠标视差接入背景指针契约，非激活指针停在画面中心、释放后平滑回中；④ 按 Three.js ShaderMaterial 重新封装为共享全屏 quad 背景契约（共用 renderer/ticker、单一 owned group、一次性释放）。ThreeUI 的 MIT 许可与 Commons Clause、GSAP "no charge" 两条约束均不冲突。

### ThreeUI — Sylva Living World (Living Green) — MIT License

- 上游：ThreeUI "Sylva Living World" 组件的 "Living Green" 变体，<https://threeui.com/three-js/sylva-living-world>；源仓库 <https://github.com/MengTo/sylva>。
- 许可：MIT License。ThreeUI 的应用代码、社区组件代码及 ThreeUI 创作的素材均为 MIT 许可。全文见第五节 MIT License。
- 本项目中的位置：`src/main/protocols/sylva/`（`scene-source.html` 为上游 `inner-green-3d.html` 原文、`three-r149.min.js` 为上游自带 Three.js r149 运行时、`scene-handler.ts` 组装场景文档并通过 `flux-sylva://` 协议下发）；`src/renderer/src/visual/backgrounds/sylva/index.ts` 实现背景契约（挂载 iframe、转发指针）。

为逐像素复刻官网效果，FluxPlayer 不再重写场景，沿用上游组件自身的渲染方式：将上游完整场景（含其自带的 Three.js r149 运行时、ACES 色调映射、像素空间构图与约 4000 行程序化几何/shader）原样注入一个 iframe，挂在透明 Stage 画布之后。仅移植 "Living Green" 单一变体（舍弃樱、枫、红杉三套季节循环），并做了四处适配：① **走自定义协议而非 srcdoc**——主进程注册 `flux-sylva://` 协议，启动时按上游 `SylvaLivingWorldScene.buildSceneDocument` 的同一隔离逻辑构建 scene-only 文档（舍弃落地页全部内容只保留 `<canvas id="scene">` + `<div id="stage">`，把外链 `three.min.js` 改为内联 bundle），并在响应头带**自己的 scoped CSP**（`script-src 'unsafe-inline'`、其余收紧）。因为 srcdoc iframe 会继承父文档 CSP，场景的 inline Three.js bundle 会被主 app 的 `script-src 'self'` 拦死；改走协议后主 app CSP 只需把 `frame-src` 从 `'none'` 放宽到 `flux-sylva:`。② iframe 置于透明 Stage 画布之后并设 `pointer-events:none` 以让上层 UI 继续收事件，Stage canvas 被设为 `position:relative;z-index:1` 以盖在 iframe（`z-index:0`）之上；③ 因两 origin 不同（`flux://app` 与 `flux-sylva://scene`），`contentWindow` 不可直接访问，宿主把指针视差经 `postMessage` 转发进 iframe，场景文档里注入一段 bridge 监听消息再 dispatch 合成 `PointerEvent`，命中上游场景自身绑定的 `pointermove`/`pointerleave` 处理器；④ 按共享背景契约封装——背景只提供一个空 group（由 Stage 的 backgroundCamera 渲染，确保切到其它背景时 iframe 被移除、Stage 透明区回落到正常背景），iframe 随背景 mount/unmount 一次性插入/移除。ThreeUI 的 MIT 许可与 Commons Clause、GSAP "no charge" 两条约束均不冲突。

---

## 二、随安装包分发的依赖

electron-vite 会将运行时依赖打进 `out/`，因此以下依赖的代码存在于分发的安装包中。

### GSAP — GreenSock Standard "no charge" License

| 包            | 版本   | 许可                                   |
| ------------- | ------ | -------------------------------------- |
| `gsap`        | 3.15.0 | GreenSock Standard "no charge" License |
| `@gsap/react` | 2.1.2  | 同上                                   |

许可全文：<https://gsap.com/standard-license>

该许可**不是** OSI 认可的开源许可，条款要点：允许在终端用户无需付费即可访问 GSAP 驱动内容的项目中免费使用；若产品要求用户付费方可访问该内容，则需购买 Club GSAP 会员许可。FluxPlayer 免费分发，符合无偿许可条件。

### 其余依赖

| 包                                  | 版本      | 许可                            |
| ----------------------------------- | --------- | ------------------------------- |
| `electron`                          | 42.x      | MIT                             |
| `electron-updater`                  | 6.8.9     | MIT                             |
| `react` / `react-dom`               | 19.x      | MIT                             |
| `three`                             | 0.185.1   | MIT                             |
| `three-text`                        | 0.6.5     | MIT                             |
| `NeteaseCloudMusicApi`              | 4.32.0    | MIT                             |
| `react-glass-ui`                    | 1.2.2     | MIT（本项目打了补丁，见第三节） |
| `zod`                               | 4.x       | MIT                             |
| `zustand`                           | 5.x       | MIT                             |
| `@tanstack/react-query`             | 5.x       | MIT                             |
| `@radix-ui/*`                       | 1.x / 2.x | MIT                             |
| `tailwindcss` / `@tailwindcss/vite` | 4.x       | MIT                             |
| `tailwind-merge`                    | 3.x       | MIT                             |
| `clsx`                              | 2.1.1     | MIT                             |
| `lucide-react`                      | 1.24.0    | **ISC**                         |
| `class-variance-authority`          | 0.7.1     | **Apache-2.0**                  |

`three-text` 内含 HarfBuzz 的 WebAssembly 构建，HarfBuzz 采用 "Old MIT" 许可，详见该包自带的许可文件。

Apache-2.0 全文：<https://www.apache.org/licenses/LICENSE-2.0>

---

## 三、打过补丁的依赖

`react-glass-ui@1.2.2` 经 `patches/react-glass-ui@1.2.2.patch` 修改后使用（pnpm `patchedDependencies`）。补丁在 `GlassCard` 中增加了静态样式分支，使 `flexibility === 0` 时不再附加 hover transform —— 这是玻璃层级动画约束所必需的。

该补丁是对 MIT 授权代码的修改，修改内容随本仓库以补丁文件形式公开。上游版本被精确锁定，升级会显式失败而非静默失配。

---

## 四、不随本项目分发的外部程序

- **Wallpaper Engine**：FluxPlayer 可以侦测并启动用户自行购买安装的 Wallpaper Engine（Steam），并读取其壁纸工程。FluxPlayer **不包含、不分发、不修改** Wallpaper Engine 的任何文件，启动前会校验其可执行文件的 Authenticode 签名。Wallpaper Engine 版权归 Kristjan Skutta 所有，其使用受 Steam 订阅协议约束。
- **Wallpaper Engine 助手进程**：`native/wallpaper-engine-helper/Program.cs` 是 FluxPlayer 自有的 C# 源码，构建时用系统自带的 .NET Framework 编译器编译，采用与本项目相同的 MIT 许可。
- **音乐服务**：FluxPlayer 是网易云音乐与 QQ 音乐的第三方客户端，与网易、腾讯均无隶属或背书关系。所有音乐内容的版权归各自权利人所有，用户须持有效账号并遵守相应服务条款。

---

## 五、许可证全文

### MIT License

适用于本文件中标记为 MIT 的所有第三方代码与依赖（各自版权归其作者所有）。

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### ISC License

适用于 `lucide-react`。

```
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License

适用于 `src/renderer/src/visual/backgrounds/rain/index.ts` 中的 Heartfelt shader 改编部分。

```
Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License (CC BY-NC-SA 3.0)

You are free to:
  Share — copy and redistribute the material in any medium or format.
  Adapt — remix, transform, and build upon the material.

Under the following terms:
  Attribution — You must give appropriate credit, provide a link to the license,
    and indicate if changes were made. You may do so in any reasonable manner,
    but not in any way that suggests the licensor endorses you or your use.
  NonCommercial — You may not use the material for commercial purposes.
  ShareAlike — If you remix, transform, or build upon the material, you must
    distribute your contributions under the same license as the original.

Full license text: https://creativecommons.org/licenses/by-nc-sa/3.0/legalcode
```

---

## 维护约定

- 新增改编自他人的源码时：在文件头部写明上游仓库、commit、版权与许可，并在第一节补一条。
- 新增运行时依赖时：核对其 `package.json` 的 `license` 字段（不要假设是 MIT），补进第二节表格；非 MIT/ISC/Apache 的许可需在第五节补全文。
- `tests/unit/license-metadata.test.ts` 会校验本文件与 README、LICENSE、`package.json` 的一致性。

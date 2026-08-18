# Renderer Tailwind 与 GSAP 渐进迁移计划

> 状态：已完成  
> 最后核验：2026-07-28  
> 适用范围：`src/renderer/**`  
> 核心目标：冻结并最终删除 `styles/m3.css`；统一玻璃组件；所有具有生命周期、状态切换或编排语义的动画优先由 GSAP 管理。

## 实施进度

| 阶段                           | 状态   | 当前结果与验证                                                                           |
| ------------------------------ | ------ | ---------------------------------------------------------------------------------------- |
| 1. 迁移清单与自动边界          | 已完成 | 临时冻结 allowlist 已完成使命，并在阶段 12 替换为永久禁止旧文件/旧类回归的测试           |
| 2. GSAP React 基础设施         | 已完成 | 已安装 `@gsap/react@2.1.2`，建立共享 `gsap/useGSAP/reduced-motion` 工具与单测            |
| 3. App Shell、顶部栏与焦点模式 | 已完成 | 布局已迁移到 Tailwind；焦点模式及退出控件由 GSAP 驱动；全量 Electron E2E 已通过          |
| 4. 播放栏                      | 已完成 | TSX/Tailwind/GSAP 已迁移，旧 PlayerBar CSS 已删除；全量 Electron E2E 已通过              |
| 5. 搜索栏与搜索弹层            | 已完成 | Tailwind/CVA 完成；搜索显隐、结果 stagger、provider 排序由 GSAP/Flip 驱动；全量 E2E 通过 |
| 6. 歌单与详情内容              | 已完成 | Library/Detail 已迁移到 Tailwind/CVA；AnimatedList 改用 GSAP；长列表性能 E2E 已通过      |
| 7. 设置与系统维护              | 已完成 | Settings/ColorPicker/GlassSelect/SystemMaintenance 已迁移；全量 Electron E2E 已通过      |
| 8. Dialog、Sheet、菜单         | 已完成 | Dialog/Sheet 生命周期已迁移到 GSAP；快速中断与 reduced-motion 验收通过                   |
| 9. 共享 UI/CVA 变体            | 已完成 | Button、Dialog/Sheet 图标按钮及 Library 行/状态语义变体已共享；全量质量门禁通过          |
| 10. Token 与 Tailwind 映射     | 已完成 | token 单一来源、Tailwind v4 映射与 GSAP duration 运行时读取已完成                        |
| 11. 收缩 `global.css`          | 已完成 | Account 已迁移；文件仅保留文档根、选择/拖拽、Stage 指针与滚动等全局行为                  |
| 12. 删除 `m3.css`              | 已完成 | 历史文件、allowlist fixture、import 与兼容 token alias 已删除；永久回归测试已启用        |
| 13. 最终视觉、性能与 HMR 验收  | 已完成 | 3 个 Electron E2E、HMR/preview 实测、160 行长列表 CDP 性能检查与完整质量门禁均通过       |

### 最近实施记录（2026-07-28）

- 新增 `motion/gsap.ts`、`motion/preferences.ts`、`motion/index.ts`，统一插件注册、duration/ease、reduced-motion 和 React 生命周期清理。
- `AnimatedContent` 已从手写生命周期迁移到 `useGSAP`。
- App Shell、顶部栏、焦点模式退出区、PlayerBar 和 SearchPanel 已完成 Tailwind/GSAP 迁移。
- SearchPanel 已改用稳定的 `data-search-*` 测试接口；provider 拖拽排序使用 GSAP Flip，结果列表使用可中断 stagger。
- `AnimatedList` 已从 Motion 迁移到 scoped `useGSAP`：只动画当前挂载的新行，选中/焦点位移和渐变透明度由可覆盖 tween 管理，reduced-motion 直接设置最终状态。
- `LibraryWorkspace` 的左右栏内部布局、provider tabs、快捷入口、歌单/歌曲行及状态视图已迁移到 Tailwind/CVA，并改用 `data-library-*` 稳定接口。
- 已删除无运行时引用的 `.playlist-rail*`、`.rotating-cover*` 历史规则、`react-bits.css` 及 `motion` 依赖。
- 修复 `global.css` 未分层通配 reset 覆盖 Tailwind utility 的问题；Tailwind 的 Preflight 继续负责 reset，`mt-auto` 等 utility 不再失效。
- `SettingsPanel`、`ColorPicker` 已迁移到 Tailwind/CVA；表单 hover/focus/checked 继续作为无状态 Tailwind 微交互。
- `GlassSelect` 菜单进入/退出与 chevron 旋转已由 scoped GSAP 管理；Radix portal 在退出完成后再卸载，并支持快速反向覆盖与 reduced-motion。
- `SystemMaintenancePanel` 已迁移到 Tailwind/CVA；进度由 width 动画改为 `scaleX` GSAP tween，`SystemMaintenancePanel.css` 已删除。
- `Dialog` 与 `Sheet` 已改为 scoped GSAP timeline：overlay opacity 与 content transform 同步编排，关闭完成后再卸载 portal，快速反向切换使用覆盖策略，并显式恢复触发控件焦点。
- 设置面板改为首次打开后保持 React 挂载，使 Dialog 能完成退出动画；`tw-animate-css` 的唯一调用已清理，依赖和 `shadcn.css` import 已删除。
- `Select` 与 `Tooltip` 当前没有 CSS 生命周期动画；审计后无需制造额外动画，Button/Skeleton 继续保留无状态 Tailwind/CSS 微交互。
- 阶段 9 将设置与维护操作统一到 `buttonVariants` 的 `glassSoft`/`glassRaised` 语义变体，Dialog/Sheet 关闭按钮复用同一图标按钮基础；Library 的 provider、快捷入口、列表行与状态视图集中到纯 CVA 变体文件。
- `m3.css` 已从冻结基线 **1944 行 / 241 个 selector group / 16 条 animation 或 transition 声明** 逐步收缩至 0 并删除；临时 selector allowlist 已替换为永久禁止文件和旧语义类回归的测试。
- 阶段 10 已将跨模块圆角、阴影、玻璃、顶部栏和 motion duration 归一到 `theme/tokens.css`，并在 `shadcn.css` 中增加 Tailwind v4 的 radius、shadow、blur 与 easing 语义映射。
- GSAP `motionDurations.fast/base/emphasized` 已改为运行时 getter：浏览器中读取同一组 CSS duration token，无 DOM 环境使用稳定 fallback，避免 CSS 微交互与 GSAP 时长漂移。
- 阶段 11 将 `AccountArea` 迁移到 Tailwind/CVA、共享 `Button` 语义变体和稳定 data hooks，删除无调用 `.footer`；`global.css` 不再包含业务模块选择器。
- 阶段 12 已删除 `m3.css`、旧 selector fixture、导入和 `--bg`/`--panel`/`--text` 等兼容 alias；Stage canvas 改用稳定 `data-stage-background` 接口，并整理为 shadcn → tokens → global → effects 的导入顺序。
- 阶段 13 新增 `renderer-migration.spec.ts`：覆盖左右 15px 圆角与玻璃变量、右侧边缘触发、2 秒关闭、540px 最小窗口、160 行虚拟列表滚动、reduced-motion、Search/Dialog 快速反向和 CDP Layout/RecalcStyle 指标。
- `AnimatedList` 不再为虚拟窗口滚动时回收的新行重复启动进入 tween，并跳过未变化的位移 tween；Dialog 增加 CSS 居中基线，GSAP 清理或快速反向后仍不会丢失定位。
- `pnpm dev` 实测修改 TSX、Tailwind class、token 分别产生 Vite HMR（App 更新 2 次、tokens 更新 1 次），无需 build；`pnpm preview` 实测运行中 0 次 HMR，静态 renderer 产物 hash 不变。
- 最终通过：`pnpm typecheck`、`pnpm lint`、`pnpm format`、`pnpm test`（51 个文件 / 310 个测试）、`pnpm test:e2e`（3 个 Electron E2E）、`pnpm build`。构建仍有既有的大 chunk 警告，不影响产物生成，未将其误报为 bundle 优化完成。

## 一、背景与结论

`src/renderer/src/styles/m3.css` 是历史组件样式的集中存放处。Tailwind 的安装只提供工具类和主题映射能力，不会自动迁移旧选择器，也不会自动消除旧 CSS 与组件类名之间的依赖。

因此本项目采用**渐进式迁移**，不进行一次性大爆炸重写：

1. `m3.css` 立即冻结，不再增加新选择器。
2. 按模块把布局、视觉状态迁移到 Tailwind + `cn` + CVA。
3. 有状态、有进入/退出、有时间线或可中断要求的动画迁移到 GSAP。
4. 每完成一个模块的视觉和测试验收，立即删除 `m3.css` 中对应的旧规则。
5. 所有旧规则清空后删除 `m3.css`，再整理最终 CSS 导入顺序。

固定执行原则：

> 迁移组件 → 迁移动画 → 增加测试 → 验证视觉与交互 → 删除旧规则 → 再进入下一个模块。

## 二、样式职责边界

| 文件/目录            | 唯一职责                                                                   | 不允许继续承载的内容               |
| -------------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| `theme/tokens.css`   | 颜色、玻璃、阴影、字体、圆角、尺寸、动画时长等设计变量                     | 组件选择器、页面布局               |
| `styles/shadcn.css`  | Tailwind v4 入口、主题变量映射、shadcn 基础样式                            | 业务组件特例                       |
| `styles/global.css`  | reset、根节点、Electron 窗口拖拽、滚动条等真正的全局规则                   | 播放器、歌单、搜索、设置等模块样式 |
| `styles/effects.css` | SVG displacement、滤镜、伪元素、浏览器兼容规则等无法合理表达为工具类的特效 | 普通布局和业务状态动画             |
| `components/**`      | Tailwind 类、`cn`、CVA 变体和组件局部状态                                  | 新增对 `m3.css` 语义类的依赖       |
| `styles/m3.css`      | 仅存尚未迁移的历史规则                                                     | 新选择器、新模块、新动画           |

### 边界约束

- 新组件不得为了“写起来方便”把规则继续加入 `m3.css`。
- 业务组件不得直接复制玻璃背景、模糊、饱和度和阴影参数，必须消费 token 或 `GlassSurface`。
- 复杂特效 CSS 必须保持小而专一，并以用途命名；不得重新形成第二个 `m3.css`。
- 已迁移组件使用稳定的 `data-*` 属性承载测试和父状态选择，不用旧类名充当测试接口。
- `tests/unit/renderer-style-boundary.test.ts` 持续检查已迁移组件没有重新引用被删除的历史语义类。

## 三、当前已完成的基础阶段

以下基础设施已完成，后续迁移必须建立在此基础上：

- `GlassSurface` 已改为 `cn + CVA` 组织。
- `GlassSurface` 保留 `elevation`、`interactive`，并增加：
  - `treatment: 'theme' | 'classicPanel'`
  - `edge: 'none' | 'left' | 'right'`
- `classicPanel` 直接消费播放器玻璃变量，统一背景、模糊、饱和度和阴影。
- 左面板圆角固定为 `0 15px 15px 0`。
- 右面板圆角固定为 `15px 0 0 15px`。
- 已抽取 `HoverEdgeSheet`，统一左右栏的边缘感应、自动关闭、定位、层级、高度适配和焦点模式行为。
- 左右栏已使用 `data-edge-sheet`、`data-edge-sheet-sensor`、`data-side` 作为稳定接口。
- 左右栏对应的 `flux-hover-panel`、`flux-library-sheet`、`flux-detail-sheet`、`classic-panel-glass`、`glass-surface` 历史职责已从 `m3.css` 清理。
- 播放器和搜索栏的 SVG 玻璃滤镜规则已迁移到 `styles/effects.css`。
- `pnpm start` 已转发到 `pnpm dev`；静态产物预览单独使用 `pnpm preview`。
- README 已说明 `preview` 默认在启动时执行一次构建，然后运行静态 `out/renderer`；运行中不提供源码 HMR。

基础阶段验收已经执行过：`pnpm typecheck`、`pnpm lint`、`pnpm format`、`pnpm test`、`pnpm test:e2e`、`pnpm build` 均通过。后续每个阶段仍需重新执行与变更范围匹配的检查。

## 四、GSAP 当前状态与版本结论

### 4.1 版本

2026-07-28 本地与 npm registry 核验结果：

| 项目                            | 版本                                   |
| ------------------------------- | -------------------------------------- |
| `package.json` 声明             | `gsap: ^3.15.0`、`@gsap/react: ^2.1.2` |
| `pnpm-lock.yaml` / 当前安装解析 | `gsap@3.15.0`、`@gsap/react@2.1.2`     |
| npm `latest`                    | `gsap@3.15.0`、`@gsap/react@2.1.2`     |
| Motion                          | 已删除（阶段 6 前为 `motion@12.42.2`） |

**结论：当前 GSAP 已经是 npm 的最新稳定版，无需修改依赖版本，也不应制造一次无实际内容的“升级”。** 后续依赖升级前使用以下命令再次核验，不能只依赖文档中的快照：

```bash
pnpm view gsap version dist-tags --json
pnpm list gsap --depth 0
```

官方参考：

- [GSAP npm package](https://www.npmjs.com/package/gsap)
- [GSAP releases](https://github.com/greensock/GSAP/releases)
- [GSAP documentation](https://gsap.com/docs/v3/)
- [GSAP React guide](https://gsap.com/resources/React/)

### 4.2 GSAP 现有使用位置

当前已统一从 `src/renderer/src/motion` 导入 GSAP 能力：

- `components/react-bits/AnimatedContent.tsx`
  - 使用 `useGSAP` 管理进入/退出和自动清理。
  - 支持纵向/横向、方向反转、透明度、不同进出时长和 reduced-motion。
- `components/shell/HoverEdgeSheet.tsx`
  - 复用 `AnimatedContent` 管理左右边缘面板进入/退出。
- `components/shell/AppTopBar.tsx`
  - 焦点模式退出区域和按钮显隐使用可覆盖 tween。
- `App.tsx`
  - App chrome 的焦点模式进入/退出由同一 GSAP timeline 编排。
- `components/player/PlayerBar.tsx`
  - 播放栏/曲目变化进入动画与进度 `scaleX` 由 GSAP 驱动。
- `features/search/SearchPanel.tsx`
  - 搜索栏显隐复用 `AnimatedContent`；搜索弹层进入、结果 stagger 使用 GSAP；provider 拖拽重排使用 GSAP Flip。
- `components/react-bits/AnimatedList.tsx`
  - 仅对当前 DOM window 中新挂载的行执行 transform/opacity entrance。
  - 选中/焦点位移与顶部/底部渐变透明度由可覆盖 tween 驱动。
  - 使用 scoped `useGSAP`、`killTweensOf` 和 reduced-motion 最终态，保留虚拟化、overscan、滚动及键盘导航。
- `components/ui/glass-select.tsx`
  - 菜单 enter/exit 与 chevron 旋转由 scoped GSAP 驱动；退出完成后才卸载 Radix portal。
- `features/system/SystemMaintenancePanel.tsx`
  - 更新进度使用左侧 transform origin 的 `scaleX` tween，避免逐帧修改 width。
- `components/ui/dialog.tsx`
  - overlay 与居中 content 使用同一 scoped timeline；退出完成后卸载 portal，并恢复打开前焦点。
- `components/ui/sheet.tsx`
  - overlay 与左右 content 使用同一 scoped timeline；根据 side 驱动 `xPercent`，支持退出后卸载与焦点恢复。

`@gsap/react@2.1.2` 已安装并投入真实组件使用。`motion/gsap.ts` 统一注册 `useGSAP` 与 `Flip`，组件不得自行重复注册；所有新增状态动画必须使用 scope、清理和 `overwrite` 策略。

### 4.3 Motion 迁移结论

阶段 6 已完成 `AnimatedList` 的 GSAP 迁移。全仓 `rg -n "motion/react|from ['\"]motion" src tests` 无运行时代码命中，`package.json` 与 lockfile 中的直接 `motion` 依赖已删除。

当前动画依赖边界为：

- GSAP：组件生命周期、状态切换、stagger、Flip、可中断 transform/opacity tween。
- Tailwind/CSS：hover/focus 的颜色、背景、边框等无状态微交互。

后续不得重新引入 Motion；如确有 GSAP 无法覆盖的场景，必须先在本文件记录唯一用途、bundle 成本和退出条件。

## 五、GSAP-first 动画规范

“优先使用 GSAP”不是把所有 `transition-colors` 都改为 JavaScript，而是明确动画所有权：**只要动画具有组件生命周期、状态切换、进入/退出、顺序编排、取消或反向播放语义，就由 GSAP 管理；CSS 只保留无状态的视觉反馈。**

### 5.1 必须优先使用 GSAP

- 面板、弹窗、菜单、搜索结果的进入和退出。
- 多元素顺序动画、stagger、timeline。
- 播放栏、搜索栏、焦点模式等有明确状态机的位移和透明度变化。
- 需要在快速切换状态时覆盖、取消、反向播放的动画。
- 拖拽或指针驱动、需要 `quickTo`/`quickSetter` 的连续变换。
- 列表插入、移除、选中态移动以及批量出现动画。
- 动画完成后需要回调、焦点转移、隐藏或卸载节点的场景。

### 5.2 CSS/Tailwind 可以保留

- 单纯的 hover/focus 颜色、边框色、背景色变化。
- 单属性、无编排、无生命周期要求的微交互。
- `prefers-reduced-motion` 降级规则。
- 骨架屏的低成本持续 pulse，前提是 reduced-motion 下禁用。
- 静态伪元素和 SVG/CSS 滤镜定义。
- 浏览器原生交互反馈，不需要 JS 协调的情况。

### 5.3 实现规则

1. 优先动画 `transform` 和 `opacity`，避免直接动画 `width`、`height`、`top`、`left`。
2. 需要展开高度时优先使用 `clip-path`、`scaleY`、FLIP 或在开始/结束时测量，避免逐帧布局抖动。
3. React 中每个动画必须限定作用域，并在卸载或依赖变化时清理。
4. 快速重复交互必须设置合理的 `overwrite`，不能积压 tween。
5. 默认时长建议为 150–300ms；只有空间跨度较大或内容较多时才超过 300ms。
6. 所有组件必须尊重 `prefers-reduced-motion`。降级时应立即到达最终状态，而不是仅把时长缩短。
7. 不同时使用 CSS transition 和 GSAP 写同一个元素的同一个属性，防止互相竞争。
8. 长列表只动画当前窗口或新增项，不对不可见的大量节点创建 tween。
9. SVG 图标动画优先动画外层包装元素，减少浏览器兼容和渲染问题。
10. GSAP 参数优先消费统一 motion token；禁止每个组件随意散落不同的 magic number。

建议在 `theme/tokens.css` 增加并逐步统一以下 token：

```css
:root {
  --motion-duration-fast: 140ms;
  --motion-duration-base: 180ms;
  --motion-duration-emphasized: 280ms;
  --motion-ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration-fast: 0ms;
    --motion-duration-base: 0ms;
    --motion-duration-emphasized: 0ms;
  }
}
```

GSAP 接收秒数，可由共享工具把 token/约定映射为 `0.14`、`0.18`、`0.28`，避免组件重复定义。

## 六、当前 CSS 动画债务清单

以下是 2026-07-27 的审计快照。迁移时必须重新搜索，避免遗漏新增或移动的规则。

### 6.1 已完成的状态动画迁移

> 阶段 3–8 已完成已识别的 CSS 生命周期/状态动画迁移。当前审计没有待迁移的 CSS enter/exit、状态 transform 或布局属性动画；后续新增同类动画必须直接使用共享 GSAP 基础设施。

| 模块                         | 完成结果                                                                   |
| ---------------------------- | -------------------------------------------------------------------------- |
| Search / Focus mode / Player | transform、opacity、stagger 与状态 timeline 已归 GSAP                      |
| AnimatedList                 | 新行进入、选中/焦点位移与渐变透明度已归 GSAP                               |
| GlassSelect                  | 菜单 enter/exit、chevron 旋转和退出后卸载已归 GSAP                         |
| SystemMaintenance            | 进度由 width transition 改为左侧 transform origin 的 `scaleX` GSAP tween   |
| `components/ui/dialog.tsx`   | overlay/content timeline、退出后卸载、焦点恢复与 reduced-motion 已完成     |
| `components/ui/sheet.tsx`    | 左右侧位移、overlay timeline、退出后卸载、焦点恢复与 reduced-motion 已完成 |

### 6.2 可保留为 CSS/Tailwind 微交互

| 文件/选择器                                       | 原因                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| `components/ui/color-picker.tsx`                  | Tailwind hover/focus 边框与 filter 反馈                                     |
| `features/settings/SettingsPanel.tsx` switch      | Tailwind 管理背景、边框与拇指位移微交互                                     |
| `m3.css` `.searchbar input`                       | 简单 focus/hover 玻璃反馈；位移类状态仍归 GSAP                              |
| `m3.css` provider tabs/buttons                    | 简单颜色、背景、边框反馈；拖拽排序动画另由 GSAP 管理                        |
| `m3.css` player buttons                           | 简单 hover/active 微交互；播放器整体状态动画归 GSAP                         |
| `m3.css` playlist/library buttons                 | 简单 hover/focus 反馈                                                       |
| `components/ui/glass-select.tsx`                  | hover/focus/highlight 颜色保留 Tailwind；菜单生命周期和 chevron 旋转归 GSAP |
| `features/system/SystemMaintenancePanel.tsx` 按钮 | hover/focus/disabled 由 Tailwind 管理；进度状态归 GSAP                      |
| `components/ui/button.tsx`                        | 通用颜色 transition                                                         |
| `components/ui/skeleton.tsx`                      | 简单持续 pulse，必须保留 reduced-motion 降级                                |
| `components/glass/surface.tsx`                    | 边框和背景色微交互，不控制进入/退出                                         |

### 6.3 审计命令

```bash
rg -n "from ['\"]gsap|gsap\\.|useGSAP|Timeline" src tests
rg -n "motion/react|from ['\"]motion" src tests
rg -n "@keyframes|animation:|transition:" src/renderer/src -g "*.css" -g "*.tsx"
rg -n "\\b(transition|duration|ease|delay|animate)-" src/renderer/src -g "*.tsx"
```

每个阶段结束时重复运行这些命令，并把新增动画归类为“GSAP 状态动画”或“CSS 微交互”，不允许处于无人负责的混合状态。

## 七、后续实施顺序

### 阶段 1：建立迁移清单与自动边界

> 状态：**已完成**（边界测试与冻结基线已落地）。

目标：让旧样式只能减少，不能反弹。

1. 按模块为 `m3.css` 的剩余选择器建立映射表：选择器、调用组件、迁移阶段、删除状态。
2. 扩展 `renderer-style-boundary.test.ts`：禁止已迁移组件引用已删除语义类。
3. 增加对 `m3.css` 新增选择器的约束；必要时维护临时 allowlist，只允许删除。
4. 记录 `m3.css` 当前行数、选择器数、动画声明数，后续阶段持续下降。
5. 确认 CSS 导入顺序，并用测试防止 `m3.css` 在迁移组件后重新获得更高覆盖权。

验收：边界测试通过；新增旧选择器能被测试捕获。

### 阶段 2：GSAP React 基础设施

> 状态：**已完成**（`@gsap/react`、共享 motion 模块与单测已落地）。

目标：在大规模动画迁移前统一 React 生命周期和 reduced-motion 处理。

1. 在第一个实际迁移 PR 中引入 `@gsap/react`，不要只提交空依赖升级。
2. 注册 `useGSAP`，封装 renderer 内部 motion 工具：reduced-motion、默认 duration/ease、清理与 overwrite 策略。
3. 将 `AnimatedContent` 从手写 `useLayoutEffect`/`killTweensOf` 迁移到 `useGSAP` 或 `gsap.context`。
4. 为快速切换 `visible`、卸载清理、回调只触发一次、reduced-motion 添加单测。
5. 约定测试环境下 GSAP 的时间推进或 mock 方式，避免动画测试不稳定。

验收：`HoverEdgeSheet` 和 `SearchPanel` 行为不变；不存在卸载后回调和残留 tween。

### 阶段 3：App Shell、顶部栏与焦点模式

> 状态：**已完成；最终全量 Electron E2E 已通过**。

目标：先清理最外层结构，建立后续模块的稳定容器。

1. 迁移 `App.tsx`、`AppTopBar.tsx` 及相关 shell 布局到 Tailwind/CVA。
2. 把焦点模式进入/退出、顶部栏和退出按钮显隐编排为一个 GSAP timeline。
3. 删除 `.focus-exit-zone button` 的 CSS 位移/透明度 transition。
4. 把窗口拖拽和 no-drag 继续留在 `global.css`，业务视觉移出。
5. 补充焦点模式、低高度窗口、键盘可达性和 reduced-motion 测试。

验收：窗口拖拽不受影响；焦点模式快速切换无闪烁；旧 shell 规则已删除。

### 阶段 4：播放栏

> 状态：**已完成；最终全量 Electron E2E 已通过**。旧 PlayerBar 规则已从 `global.css` 与 `m3.css` 删除。

目标：统一播放器玻璃视觉和所有状态动画。

1. 把 PlayerBar 布局、按钮、进度、封面、音量和模式控件迁移到 Tailwind/CVA。
2. 继续保留小面积控制条的 SVG displacement 玻璃算法。
3. 播放栏整体显隐、封面状态变化、模式切换等使用 GSAP。
4. 全仓确认 `.rotating-cover` 无运行时引用后删除其 stale CSS；若未来重新实现指针驱动封面，必须使用 `quickTo`/可覆盖 tween，避免 transform 的 CSS 与 GSAP 双写。
5. 按钮 hover/focus 色彩微交互可保留 Tailwind transition。
6. 删除播放器对应的 `m3.css` 规则。

验收：播放/暂停、切歌、拖动进度、音量、循环模式不回归；动画只使用 transform/opacity 等合成属性。

### 阶段 5：搜索栏与搜索结果

> 状态：**已完成；最终全量 Electron E2E 已通过**。旧搜索选择器已从 `global.css` 与 `m3.css` 删除。

目标：移除现有 GSAP 与 CSS transition 的竞争，统一搜索状态动画。

1. 将 SearchPanel 布局和结果列表样式迁移到 Tailwind/CVA。
2. `AnimatedContent` 只负责搜索容器的进入/退出，`.search-shell` 不再写同属性 transition。
3. 搜索展开、结果出现、provider 切换和必要的 stagger 使用 GSAP timeline。
4. 输入框 hover/focus 色彩可保留 Tailwind transition。
5. 保持输入防抖、离开延时关闭、键盘退出和焦点行为不变。
6. 删除搜索对应的 `m3.css` 规则。

验收：开发模式修改 TSX/Tailwind 类立即 HMR；快速输入和快速开关不积压 tween。

### 阶段 6：左右歌单栏内部内容

> 状态：**已完成；最终长列表性能检查与全量 Electron E2E 已通过**。

目标：在外壳已迁移的基础上，清理内部列表、详情和选中态。

1. 迁移 `LibraryWorkspace`、歌单列表和详情列表的内部布局与视觉样式。
2. 将 `AnimatedList` 从 Motion 迁移到 GSAP，保持虚拟化、overscan、键盘导航和选中行为。
3. 只对可见窗口、新增项或状态变化项创建 tween，避免长列表性能下降。
4. 左右面板继续使用 CSS `backdrop-filter`，不得给大面积滚动容器启用 SVG displacement。
5. 删除 `.playlist-rail-list`、`.library-playlist-list` 等历史规则。
6. 全仓确认没有 `motion` import 后删除 `motion` 依赖，并重新生成 lockfile。

执行结果：以上 1–6 已完成；旧 library/detail/playlist-rail/rotating-cover 规则已删除，`m3.css` 降至 **939 行 / 125 个 selector group / 5 条动画声明**。目标 Electron E2E 已验证左右 15px 圆角、玻璃变量、边缘触发、播放器安全布局与焦点模式。阶段 13 已完成长列表 CDP Performance 验收。

### 阶段 7：设置与系统维护面板

> 状态：**已完成；最终全量 Electron E2E 已通过**。

目标：清理表单控件、维护进度和设置模块的独立 CSS。

1. 把设置面板、switch、色板、select、按钮迁移到 shadcn/Tailwind/CVA。
2. hover/focus/checked 微交互使用 Tailwind transition。
3. `glass-select-in` 关键帧迁移为 GSAP 菜单生命周期动画后删除。
4. 系统维护进度从 width transition 改为 transform/`scaleX` GSAP tween。
5. 删除 `SystemMaintenancePanel.css` 中已迁移规则；若文件清空则删除其 import 和文件。
6. 补充表单键盘、焦点、disabled、reduced-motion 测试。

验收：不存在布局属性逐帧动画；Radix 菜单退出动画完成后再卸载，焦点恢复正常。

执行结果：以上 1–6 已完成。Settings/ColorPicker/GlassSelect/SystemMaintenance 已迁移；`SystemMaintenancePanel.css` 已删除；`m3.css` 降至 **162 行 / 23 个 selector group / 0 条 animation 或 transition 声明**。目标与最终全量 Electron E2E 均已通过。

### 阶段 8：Dialog、Sheet、菜单及剩余控件

> 状态：**已完成；最终全量 Electron E2E 已通过**。

目标：统一 overlay 类组件动画，消除散落的 `tw-animate-css` 状态动画。

1. 为 Dialog/Sheet 建立 GSAP motion wrapper，不破坏 Radix 的焦点锁、ESC、外部点击和 portal。
2. 将 overlay opacity 与 content transform 编入同一 timeline。
3. 正确处理关闭动画和延迟卸载；禁止只处理进入、不处理退出。
4. 迁移剩余菜单、tooltip、popover 等复杂状态动画。
5. 简单 Button/Skeleton 微交互继续保留 CSS/Tailwind。
6. 若 `tw-animate-css` 已无调用，再删除依赖/import；否则保留并记录唯一用途。

验收：快速连续开关不闪烁、不丢焦点、不留下不可点击遮罩。

执行结果：以上 1–6 已完成。Dialog/Sheet 的 overlay 与 content 已统一到 scoped GSAP timeline；退出完成后才卸载 portal，reduced-motion 立即到达最终态，触发控件焦点可恢复。`tw-animate-css` 已从 `shadcn.css`、`package.json` 与 lockfile 删除。当前 `Select`/`Tooltip` 无复杂状态动画，无需额外迁移；Button/Skeleton 微交互按规范保留。目标 Electron E2E 已验证关闭按钮、ESC、延迟卸载与焦点恢复。

### 阶段 9：抽取共享 UI/CVA 变体

> 状态：**已完成；最终全量 Electron E2E 已通过**。

目标：避免迁移后出现大量重复、难维护的 className。

1. 识别按钮、图标按钮、列表项、标签、输入框、面板标题、空状态的共享变体。
2. 只抽取存在两个以上真实调用点的模式，避免提前抽象。
3. 组件 API 使用语义化 variant，不允许业务层传入大量布尔值拼视觉。
4. 保持 `cn` 合并顺序明确，调用方 className 能在预期范围内覆盖。
5. 为关键 variant 添加快照或 class 合并单测。

验收：重复类显著减少，且没有重新引入全局语义类。

执行结果：以上 1–5 已完成。仅抽取两个以上真实调用点：设置/维护操作按钮统一到 `buttonVariants`，Dialog/Sheet 关闭按钮复用共享图标按钮类，Library provider/shortcut/row/status 集中到 `features/library/variants.ts`。新增 `renderer-ui-variants.test.ts` 验证语义变体、compound variant 与 `cn` 调用方覆盖顺序；边界测试禁止局部旧变体回归。质量门禁通过（51 个文件 / 307 个测试），目标 Electron E2E 通过。

### 阶段 10：统一 token 与 Tailwind 主题映射

> 状态：**已完成；最终全量 Electron E2E 已通过**。

目标：形成单一设计变量来源。

1. 盘点硬编码颜色、圆角、阴影、blur、duration 和 easing。
2. 把跨模块共用值提升到 `theme/tokens.css`。
3. 在 `shadcn.css` 中完成 Tailwind v4 theme mapping。
4. 玻璃 token 继续区分大面积 panel 与小面积 control 的性能策略。
5. 清理重复、无调用和意义重叠的 token。
6. 增加 motion token，并让 GSAP helper 与 CSS 微交互共同消费同一语义值。

验收：业务组件不散落重复玻璃参数和动画 magic number；主题切换视觉一致。

执行结果：以上 1–6 已完成。`tokens.css` 已成为颜色、字体、圆角、阴影、玻璃、Shell 尺寸和 motion duration 的单一来源；`global.css` 删除重复 `:root` token；`shadcn.css` 完成 Tailwind v4 radius/shadow/blur/easing 映射；组件中的重复 9/14/22px 圆角、阴影和 duration magic number 已迁移为语义 token。`motion/preferences.ts` 新增 CSS duration 解析及 getter，GSAP 与 CSS 微交互共同消费 duration token。边界和 motion 单测已覆盖单一来源与时长转换。质量门禁通过（51 个文件 / 309 个测试），目标 Electron E2E 通过。

### 阶段 11：收缩 `global.css`

> 状态：**已完成；最终全量 Electron E2E 已通过**。

目标：确保全局文件只剩真正跨应用的规则。

1. 保留 reset、`html/body/#root`、窗口拖拽、基础滚动与无障碍全局规则。
2. 将任何具体组件选择器迁回组件或变体。
3. 检查通配选择器和高 specificity 规则，避免压过 Tailwind。
4. 检查 `!important`，只保留有明确浏览器/Electron 原因的项并注释。

验收：`global.css` 不认识 PlayerBar、SearchPanel、Library、Settings 等业务模块。

执行结果：以上 1–4 已完成。`AccountArea` 的头像、昵称、VIP/授权状态和登录/登出按钮已迁移到 Tailwind、本地 CVA 与共享 `Button` 语义变体，调用方改用 `data-account-*` hook；无运行时调用的 `.footer` 已删除。全局默认禁止意外文本选择，输入/编辑区域显式恢复，因而不再依赖 PlayerBar、Library 或 Stage 等业务类名。边界测试永久限制 `global.css` 的职责。质量门禁通过（51 个文件 / 310 个测试），目标 Electron E2E 通过。

### 阶段 12：删除 `m3.css`

> 状态：**已完成；最终全量 Electron E2E 已通过**。

目标：完成历史样式退出。

1. 确认 `m3.css` 选择器映射表全部标记完成。
2. 全仓搜索旧语义类，无组件引用。
3. 删除 `src/renderer/src/styles/m3.css`。
4. 删除 `main.tsx` 中对应 import。
5. 调整最终导入顺序：Tailwind/shadcn → tokens/global → effects/必要局部样式。
6. 将临时“冻结”测试改为“禁止文件和旧类重新出现”的永久测试。

验收：删除文件后 typecheck、lint、format、unit、E2E、build 全部通过；界面无视觉差异。

执行结果：以上 1–6 已完成。最后剩余规则中除 Stage canvas 指针交互外均为无调用历史选择器；Stage 已迁移到 `data-stage-background`，指针规则归入真正全局的拖拽行为。`m3.css`、临时 allowlist fixture 和 `main.tsx` import 已删除，兼容 token alias 已清理，CSS 顺序整理为 shadcn → tokens → global → effects，Glass 局部样式不再重复导入 tokens。冻结测试已改为永久禁止文件、旧类和 import 回归，并覆盖兼容 alias 与导入顺序。质量门禁通过（51 个文件 / 310 个测试），目标 Electron E2E 通过。

### 阶段 13：最终视觉、性能与 HMR 验收

> 状态：**已完成**。

目标：确认迁移不仅能构建，而且没有交互和性能回归。

1. 在 `pnpm dev` 下分别修改 TSX、Tailwind class 和 token，确认 renderer 无需 build 即时更新。
2. 明确验证 `pnpm preview` 仅在启动时构建一次，之后运行静态产物，避免再次误判 HMR。
3. E2E 检查左右栏圆角、玻璃背景、backdrop filter、阴影和边缘触发。
4. 检查 2 秒延迟关闭、焦点模式、小窗口高度、长列表滚动。
5. 检查 Dialog/Sheet/Search 快速开关和动画中断。
6. 开启系统 reduced-motion，确认所有动画立即稳定到最终状态。
7. 使用 Chromium Performance 检查长列表、玻璃面板和动画；不得出现持续 layout thrashing。
8. 执行完整质量门禁。

```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm test:e2e
pnpm build
```

执行结果：以上 1–8 已完成。开发模式中依次写入临时 TSX、Tailwind class 和 token probe，Vite 分别记录 2 次 App HMR 与 1 次 token HMR，probe 随后按原始字节恢复；preview 在同类源码 probe 下保持 0 次 HMR，运行中的 renderer 输出 hash 未变化。新增最终迁移 E2E，使用 160 条最近播放数据验证右侧详情长列表、左右玻璃、固定圆角、边缘触发、2 秒关闭、Electron 540px 最小高度、reduced-motion 和快速反向；CDP Performance 指标验证虚拟滚动后不存在持续 layout thrashing，DOM 行数保持窗口化。验收中发现并修复原 `max-height:520px` 小窗口分支低于 Electron 540px 最小高度而不可达的问题，以及 Dialog 在 GSAP 清理后可能丢失居中 transform 的问题。最终完整质量门禁通过：51 个 Vitest 文件 / 310 个测试、3 个 Electron E2E、生产构建成功。

### 阶段 14：播放栏、列表、歌词动画与背景互斥修正

> 状态：**实现完成，质量门禁见本节执行结果**。

目标：收敛迁移完成后的视觉反馈，并把歌词动效与背景来源变为明确、可持久化的用户偏好。

1. PlayerBar 恢复原有 `860px` 最大宽度，小窗口仍使用 `w-full` 自适应。
2. 左右歌单的 playlist/detail 行移除默认、hover、selected、focused 边框；状态反馈只使用背景色。
3. 3D 歌词默认行距由 `0.64` 收紧到 `0.46`，增加四种独立模式：
   - `compact`：紧凑滚动；
   - `fade`：柔和淡入；
   - `lift`：上浮切换；
   - `focus`：仅当前歌词，不保留常驻上下文。
4. 歌词模式通过设置面板切换并写入 `flux-lyrics-animation-mode-v1`；StageCanvas 暴露 `data-lyrics-animation-mode` 供验收。
5. 歌词几何进入、布局切换与退出统一使用 GSAP 驱动 Three.js 对象的 transform/opacity 数值；旧歌词在新几何准备完成后才退出，`focus` 模式形成覆盖交叉过渡，不新增 CSS keyframes。
6. reduced-motion 直接稳定到最终状态并及时回收退出 mesh/material。
7. 背景来源改为显式、互斥的 `dynamic | wallpaper` 状态：选择动态效果立即替换自定义背景，导入自定义背景立即替换动态背景，已导入素材可在设置中重新启用或切回动态背景。
8. 背景模式写入 `fluxplayer-background-mode-v1`；旧安装首次读取到已有自定义背景时自动迁移到 `wallpaper`，媒体加载失败时切回 `dynamic`。

验收：PlayerBar 计算宽度不超过 `860px`；列表行计算边框为 `0px`；四种歌词模式可切换并持久化；`focus` 的窗口半径为 0；动态背景与自定义背景不会同时渲染。

执行结果：以上 1–8 已完成。typecheck、lint、format、52 个 Vitest 文件 / 314 个测试、3 个 Electron E2E 与生产构建全部通过。E2E 已覆盖 PlayerBar 最大宽度、列表行四边 `0px`、歌词 `focus` 设置与持久化、背景模式持久化；生产构建仍保留既有 renderer 大 chunk 警告，本阶段未将其误报为已完成的 bundle 优化。

## 八、接口目标

```ts
type GlassTreatment = 'theme' | 'classicPanel'
type GlassEdge = 'none' | 'left' | 'right'

interface GlassSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  elevation?: 'flat' | 'raised'
  interactive?: boolean
  treatment?: GlassTreatment
  edge?: GlassEdge
}

interface HoverEdgeSheetProps {
  side: 'left' | 'right'
  open: boolean
  available?: boolean
  onOpenChange(open: boolean): void
  children: React.ReactNode
}
```

这些接口只属于 renderer，不影响主进程、preload、IPC 或音乐服务协议。

建议新增内部动画接口时保持小而稳定，例如：

```ts
interface MotionPreferences {
  reduced: boolean
  duration: {
    fast: number
    base: number
    emphasized: number
  }
  ease: {
    standard: string
    enter: string
    exit: string
  }
}
```

## 九、每阶段测试矩阵

| 检查             |                     每个模块 | 删除 `m3.css` 前 | 最终阶段 |
| ---------------- | ---------------------------: | ---------------: | -------: |
| 相关单测         |                         必须 |             必须 |     必须 |
| `pnpm typecheck` |                         必须 |             必须 |     必须 |
| `pnpm lint`      |                         必须 |             必须 |     必须 |
| `pnpm format`    |                         必须 |             必须 |     必须 |
| Electron E2E     |                   涉及交互时 |             必须 |     必须 |
| `pnpm build`     |                     阶段收尾 |             必须 |     必须 |
| reduced-motion   |                   涉及动画时 |             必须 |     必须 |
| HMR 手工验证     |         涉及 renderer 样式时 |             必须 |     必须 |
| Performance 录制 | 涉及长列表/大玻璃/连续动画时 |             必须 |     必须 |

重点 E2E 断言：

- 左栏圆角：`0px 15px 15px 0px`。
- 右栏圆角：`15px 0px 0px 15px`。
- 两侧面板背景、backdrop filter 和阴影消费播放器玻璃变量。
- 边缘悬停可打开，离开后按既有 2 秒延迟关闭。
- 低高度窗口、焦点模式和长列表滚动行为不变。
- 快速反向切换时，GSAP tween 被覆盖而非排队。
- reduced-motion 下不播放空间位移动画。

## 十、建议提交顺序

保持每个提交可独立审查和回滚，不把所有模块塞进一个提交：

1. `docs(renderer): record Tailwind and GSAP migration plan`
2. `test(renderer): enforce legacy style freeze`
3. `refactor(motion): add GSAP React lifecycle utilities`
4. `refactor(renderer): migrate app shell and focus motion`
5. `refactor(player): migrate player styles and animation to GSAP`
6. `refactor(search): migrate search styles and animation to GSAP`
7. `refactor(library): migrate list styles and replace Motion with GSAP`
8. `refactor(settings): migrate settings and maintenance motion`
9. `refactor(ui): migrate dialog sheet and menu motion`
10. `refactor(renderer): consolidate CVA variants and design tokens`
11. `refactor(renderer): reduce global styles and remove m3.css`
12. `test(renderer): complete visual performance and HMR acceptance`

## 十一、完成定义

只有同时满足以下条件，迁移才算完成：

> 以下条件已于 2026-07-28 全部满足。

- `m3.css` 已删除，且有测试防止旧文件/旧语义类回归。
- 业务布局和视觉状态由 Tailwind/CVA 负责。
- 复杂特效仅存在于职责单一的小型 effects 文件。
- 状态型动画由 GSAP 统一管理，不与 CSS transition 争夺同一属性。
- Motion 已完成迁移并从依赖中删除，边界测试阻止其回归。
- 所有动画有正确清理、快速中断和 reduced-motion 行为。
- 左右玻璃面板保持播放器一致的液态玻璃视觉和固定 15px 内侧圆角。
- 开发使用 `pnpm dev`/`pnpm start` 可获得 renderer HMR；`pnpm preview` 的静态产物语义清晰。
- 全量质量门禁和 Electron E2E 通过。

## 十二、全局液态玻璃正式统一阶段

> 状态：**已完成**（2026-08-17）。本阶段取代本文早期的 classic panel、播放器/搜索 SVG 例外、`effects.css` 和固定 15px 贴边圆角策略；冲突处以 [liquid-glass-system.md](liquid-glass-system.md) 为准。

- `components/glass` 现由 `config.ts`、`persistence.ts`、`store.ts`、`surface.tsx`、`glass.css` 和 `index.ts` 组成，业务代码只能通过唯一 `GlassSurface` 使用 `react-glass-ui`。
- 删除 Demo、LiquidGlassSurface、classic-control、旧 SVG 生成器和 `effects.css`。主题持久化升到 v3，旧 v2 只迁移颜色、字体和歌词状态。
- SettingsPanel 新增固定尺寸的第五个“玻璃”Tab；预览按 rAF 合并，提交只写一次 `fluxplayer-glass-v1`。
- 左右栏、PlayerBar、搜索、设置、Wallpaper Engine 对话框和 GlassSelect 浮层统一消费同一配置。轻量按钮只消费派生 CSS 变量，不创建嵌套 SVG 玻璃。
- 第三方 patch 在静态配置下关闭 hover transform，并直接从 props 计算光照阴影，消除 effect 二次渲染。
- View Transition 只移动左右栏和搜索壳的位图；Dialog、Sheet、Select、搜索结果只动画透明度。实时 GlassCard 和祖先禁止动态 transform。
- Electron E2E 会把 blur 调到 40，并逐一检查已挂载真实表面的配置签名和计算后的 backdrop-filter，防止再次出现“只有 PlayerBar 生效”。

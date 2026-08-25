# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

FluxPlayer 是一个 Electron + React 桌面音乐播放器，聚合网易云音乐与 QQ 音乐两个 provider，使用 Three.js 渲染动态背景与 3D 歌词。使用 pnpm、electron-vite、oxlint/oxfmt（非 ESLint/Prettier）、Vitest + Playwright。

## Commands

```bash
pnpm dev              # electron-vite 开发（Renderer CSS/TSX HMR）
pnpm start            # pnpm dev 的便捷别名
pnpm build            # 三进程构建到 out/
pnpm preview          # electron-vite preview（读取 out/，无源码热更新）
pnpm typecheck        # 三套 tsconfig 都要过：tsconfig.node.json + tsconfig.web.json + tsconfig.test.json
pnpm lint             # oxlint
pnpm format           # oxfmt --check（校验）
pnpm format:write     # oxfmt（写入）
pnpm test             # vitest run（全部单测）
pnpm test:e2e         # 先 build 再跑 playwright（真实 Electron）
pnpm smoke            # scripts/smoke.mjs：无头启动校验窗口能加载、无本地 TCP
pnpm build:win        # 打 NSIS 安装包到 dist/
```

运行单个测试：

```bash
pnpm vitest run tests/unit/playback-match.test.ts     # 单文件
pnpm vitest run -t "部分用例名"                          # 按名字过滤
pnpm exec playwright test tests/e2e/player.spec.ts     # 单个 e2e（需先 pnpm build）
```

注意：改动主进程/preload/server/shared 后必须跑 typecheck —— 它串行跑 node / web / test 三套配置，各 tsconfig 只覆盖各自的 src 子树，只跑一套会漏掉另一侧的类型错误。按影响面只跑受影响的那套即可（见下文验证序列）。`.npmrc` 已指向 npmmirror 镜像。

## Architecture

### 三进程 + 安全边界

代码按 Electron 三进程 + 共享层分层，路径别名固定：`@shared` → `src/shared`，`@server` → `src/server`，`@`/`@renderer` → `src/renderer/src`。

- **`src/main`** —— Electron 主进程。持有 provider 凭据、注册自定义协议、编排更新器/性能治理，是唯一能接触上游 URL 和 cookie 的地方。
- **`src/preload/main.ts`** —— 唯一 `contextBridge` 出口，暴露 `window.fluxDesktop`（编译为 **CJS** `.cjs`，见 electron.vite.config.ts 注释：ESM preload 会静默悬死）。
- **`src/renderer/src`** —— React 19 UI，无任何网络/凭据能力，只经 `window.fluxDesktop` 走 IPC。
- **`src/server`** —— provider 实现（netease/qq），进程无关的纯逻辑，被 main 通过 `createMainMusicService` 适配后调用。
- **`src/shared`** —— 跨进程契约（IPC 通道、zod schema、领域模型），renderer 与 main 都 import 但不含运行时副作用。

**关键安全不变量（改动 IPC/媒体路径时务必保持）：**

1. **上游 URL / cookie 绝不过 IPC。** `MusicService.resolvePlayback` 返回 `MainPlaybackResource`（含 `upstreamUrl`），main 在 [src/main/ipc.ts](src/main/ipc.ts) 里用 `audioHandles.create()` 换成不透明的 `flux-media://audio/<handle>` 句柄再回传 renderer。句柄 LRU + TTL 存活于主进程（[src/main/protocols/media.ts](src/main/protocols/media.ts)）。
2. **每个 IPC handler 经 `secureHandle` 包裹**：先 `isPrimaryRenderer` 校验 sender 是主窗口主 frame 且 origin 匹配（拒绝 `UNAUTHORIZED_RENDERER`），再用 zod schema 解析入参（失败抛 `INVALID_REQUEST`）。新增 IPC 必须走这条路径，schema 定义在 [src/shared/music-schema.ts](src/shared/music-schema.ts)。
3. **封面/音频只走 `flux-media://` 协议**，主机名有 allowlist（`COVER_HOST_SUFFIXES` / `isAllowedCoverUrl`），响应头被重写、`Access-Control-Allow-Origin` 固定 `flux://app`。
4. **网易云 SDK 走固定 allowlist 门面**（[src/server/providers/netease/sdk.ts](src/server/providers/netease/sdk.ts)）：`NCM_ENDPOINT_ALLOWLIST` 只 deep-import 明确列出的模块，绝不 import 包根、不扫描模块目录。加端点要显式加进 loader map。
5. **凭据落盘经 `SafeCredentialStore`**（Windows DPAPI safeStorage 加密 + 校验 + replacement journal 崩溃恢复），只接受密文、不降级明文（[src/main/credentials.ts](src/main/credentials.ts)）。

### Provider 编排

[src/server/music/index.ts](src/server/music/index.ts) 的 `MusicService.select()` 是 provider 分发的唯一 switch —— 加第三个 provider 要改这里。provider 各自把上游响应映射成 `UnifiedSong` / `UnifiedPlaylist`（[src/shared/models.ts](src/shared/models.ts)），音质等级统一为 `QualityLevel` 五档，`normalizeQualityPreference` 做别名归一。

**chksz 不是第三个 provider，是聚合/解锁后端。** `ProviderId` 联合类型只有 `'netease' | 'qq'`，`select()` 也只在这两者间二选一。chksz（[src/server/providers/chksz/](src/server/providers/chksz/)）是 `MusicService` 内部的 fallback 层，经 search / resolvePlayback / getLyrics 请求里的 `backend?: 'direct' | 'chksz'` 字段切换：

- 账号 / 歌单列表 / 我喜欢 / 发现页**永远走直连**，不经过 chksz
- search / resolvePlayback / getLyrics：直连优先，直连无音源 / 仅试听 / 无歌词时用 chksz 同 id 兜底
- `backend=chksz` 强制走 chksz 且**不回退直连**（用户明确要求时）
- chksz 配额 / 限流 / Key 错误会向上传（播放器看得到原因），其它 chksz 错误静默回退直连结果

chksz 的 `id` 是 `'chksz' as const` 但它**不进 `ProviderId`**，别在 `select()` 或 `UnifiedSong.provider` 里看到 chksz。

### 播放引擎

[src/renderer/src/playback/engine.ts](src/renderer/src/playback/engine.ts) 的 `PlaybackEngine` 是单例，**独占唯一 `HTMLAudioElement` 和所有异步播放状态机**。Zustand store（[src/renderer/src/stores/player.ts](src/renderer/src/stores/player.ts)）只是它的可观察 UI 投影和用户动作门面 —— 通过 `connect(port)` 注入 state 读写口，别在 store 里塞播放逻辑。高频进度用独立 `usePlaybackProgress` store 隔离，避免整树重渲染。引擎内建：`loadGeneration` 防竞态、20s 媒体加载超时（`MEDIA_LOAD_TIMEOUT_MS`）、试听 30s 截断、shuffle 环形游标。

注意这三件事**引擎不做**，别去找对应实现：音质降级发生在**服务端**（provider 内部按候选链逐档回退，见 [src/server/providers/netease/index.ts](src/server/providers/netease/index.ts) 的 qualities 循环），引擎侧只用 `isQualityDowngrade` 提示实际档位低于偏好；**没有跨 provider 自动换源**；**没有失败黑名单** —— `resolvePlayback` 一次失败即 `failPlayback` 进 error 态，同一首歌只提示一次。

### 视觉系统（Three.js）

- **单一 Stage**：`VisualStage`（[src/renderer/src/visual/stage.ts](src/renderer/src/visual/stage.ts)）持有唯一 renderer/scene/camera，所有子层共用它，绝不自建动画时钟。
- **单一 RAF**：全局 `ticker`（[src/renderer/src/perf/ticker.ts](src/renderer/src/perf/ticker.ts)）是**视觉循环**唯一的 `requestAnimationFrame` 注册表，受主进程 `PerfGovernor` 广播的 `PerfState` 约束（minimize/hide → background/suspended 降频）。视觉循环别自己开 RAF。例外只有两类：GSAP 自带 ticker（`@gsap/react` 是动画主干，刻意如此），以及一次性的非循环 RAF（如 dialog/sheet 的焦点还原）。已知有两处自建 RAF 节流绕过了 `PerfState`（`components/glass/store.ts`、`features/settings/WallpaperEngineLayer.tsx`），**是待收敛的债**：改造时把它们换成 `ticker` 的注册口，让 minimize/hide 时 glass 刷新与壁纸层节流跟随 `PerfState` 一起降频。不是可效仿的先例。
- **动态背景**：`DynamicBackgroundManager` 只实例化 HTML Light / Caustic / Rain / Cloud / Sylva 中当前选中的一个，默认 Sylva（苔境）。前三者共享 renderer/ticker；不再存在音频分析器、封面粒子或 legacy preset。Caustic 是 Shadertoy "Tileable Water Caustic" 的移植（青蓝水底 + 白色焦散脊，配色固定、`setAccentColor` 刻意空实现）；Rain 是 Shadertoy "Heartfelt" 的移植（CC BY-NC-SA 3.0，雨打玻璃 + 心形故事自动循环、移除了全部鼠标交互、iChannel0 使用随项目分发的 Pexels 照片）；Cloud 是 ThreeUI "Cloud Field" 的移植（夜空 + 五层视差山峦 + 流星）。Sylva（苔境）为逐像素复刻 ThreeUI "Sylva Living World" 的 Living Green 变体：**不重写场景**，把官方完整场景（含其自带 Three.js r149 运行时）原样注入一个 iframe，挂在透明 Stage 画布之后；因此 Sylva 是唯一**不共享 Stage renderer/ticker**、自带独立 WebGL 上下文与 RAF 的背景。注意 Sylva 的 iframe 走的是自定义协议而非 srcdoc：主进程注册 `flux-sylva://` 协议（`src/main/protocols/sylva/scene-handler.ts`，启动时内联场景 HTML+three.js 构建 scene-only 文档）并在响应头里带**自己的 scoped CSP**（`script-src 'unsafe-inline'`、`frame-ancestors flux://app http://localhost:*`，其余收紧）——因为 srcdoc iframe 会继承父文档 CSP，场景的 inline Three.js bundle 会被 `script-src 'self'` 拦死，而 `frame-ancestors 'none'` 会让 app 也无法嵌入它。场景文档构建器**必须用 indexOf+slice 拼接**而非 `String.replace`：Three.js r149 bundle 里有字面 `$'`（`.replace('WC', ah) + '$'`），`replace` 的替换串会把 `$'` 当成「匹配项之后的目标串」特殊模式，把 runtime 标签之后的全部内容拼进 three.js 脚本，截断并破坏场景（`tests/unit/sylva-scene-protocol.test.ts` 守这条不变量）。主 app CSP 因此只需把 `frame-src` 从 `'none'` 放宽到 `flux-sylva:`（dev 的 `src/renderer/index.html` http-equiv 与 production 的 `PRODUCTION_CSP` 都改了，`electron-static-protocol.test.ts` 守这条不变量）。背景契约为此扩展了可选 `mount/unmount` DOM 生命周期（`DynamicBackground.mount?(container)`）：纯 WebGL 背景不实现，Sylva 在 `mount` 时把 iframe 插到容器首子（`z-index:0`，canvas 之下）、`unmount` 时移除；Stage canvas 被设为 `position:relative;z-index:1` 以盖在 iframe 上方（透明区透出苔境，歌词画在 canvas 上）。指针视差由宿主经 `postMessage` 转发进 iframe（origin 不同，contentWindow 不可直接访问），场景文档里注入一段 bridge 监听 `sylva-pointer` 消息再 dispatch 合成 `PointerEvent` 命中场景自身处理器。构图参考与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- **React 边界**：`StageCanvas` 只传入 `backgroundEffect`、启用状态和歌词交互参数；自定义图片/视频背景启用时释放动态背景，但保留歌词场景。
- **上游许可**：React Bits 适配代码保留来源注释，许可证全文与依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

### 测试约定

- 单测环境 `node`（vitest.config.ts），provider 映射有 `tests/unit/__snapshots__` 快照 + `tests/fixtures` 录制夹具（`pnpm record:fixtures` 重录）。
- e2e 起真实 Electron（`tests/e2e/electron.fixture.ts`），`FLUX_E2E=1` 时 [src/main/e2e-network-guard.ts](src/main/e2e-network-guard.ts) 会 monkey-patch http/https/fetch 阻断一切非 loopback 请求；音乐请求靠 fixture 注入。`workers: 1`，非并行。
- 有专门的边界测试：`server-boundary.test.ts`、`electron-ipc-security.test.ts`、`netease-sdk-allowlist.test.ts` —— 动 IPC/协议/SDK 门面时先看它们。

### 改动后的验证序列

改完一类文件后**先跑对应的边界/单元测试**，确认没破坏不变量。测试按改动区域分组（区域 → 必跑的单测文件，路径相对 `tests/unit/`）：

| 改动区域                                                | 先跑这些测试                                                                                                                                                                    | 理由                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `src/main/ipc.ts`、`src/main/protocols/`                | `electron-ipc-security.test.ts`、`electron-media-protocol.test.ts`、`electron-static-protocol.test.ts`、`server-boundary.test.ts`                                               | secureHandle / isPrimaryRenderer / flux-media 句柄 / CSP 不变量 |
| `src/server/providers/netease/sdk.ts`                   | `netease-sdk-allowlist.test.ts`、`netease-sdk.test.ts`                                                                                                                          | NCM_ENDPOINT_ALLOWLIST 门面                                     |
| `src/server/providers/netease/`                         | `netease-mappers.test.ts`、`netease-fixture.test.ts`                                                                                                                            | 映射快照，改映射要核对 `__snapshots__/` 是否需更新              |
| `src/server/providers/qq/`                              | `qq-mappers.test.ts`、`qq-fixture.test.ts`、`qq-search.test.ts`、`qq-songurl.test.ts`、`qq-restriction.test.ts`、`qq-session.test.ts`                                           | 映射 + 搜索 + 播放地址 + 限制 + 会话                            |
| `src/server/providers/chksz/`                           | `music-service.test.ts`、`provider-contract-validation.test.ts`                                                                                                                 | chksz 回退逻辑走 MusicService 编排                              |
| `src/server/music/index.ts`                             | `music-service.test.ts`、`provider-contract-validation.test.ts`、`provider-auth-validation.test.ts`                                                                             | select / backend 切换 / 回退编排                                |
| `src/main/credentials.ts`                               | `credentials.test.ts`                                                                                                                                                           | SafeCredentialStore DPAPI 不变量                                |
| `src/renderer/src/playback/engine.ts`、`quality.ts`     | `player-failure.test.ts`、`player-modes.test.ts`、`player-progress-isolation.test.ts`、`playback-quality.test.ts`                                                               | 播放状态机 + 防竞态 + 试听截断 + 质量降级提示                   |
| `src/renderer/src/visual/`、`perf/ticker.ts`            | `visual-scene.test.ts`、`visual-backgrounds.test.ts`、`visual-lyrics3d-mesh.test.ts`、`visual-lyrics-animation.test.ts`、`visual-lyrics3d-fonts.test.ts`、`perf-ticker.test.ts` | 单一 Stage / 单一 RAF / 3D 歌词                                 |
| `src/renderer/src/components/glass/`                    | `glass-system.test.ts`、`renderer-style-boundary.test.ts`                                                                                                                       | 玻璃包装层 + no-restricted-imports                              |
| `src/renderer/src/features/search/`                     | `search-query-cancellation.test.ts`、`search-hover-interaction.test.ts`                                                                                                         | 搜索取消 + 悬停                                                 |
| `src/renderer/src/theme/`                               | `theme-foundation.test.ts`、`theme-classic-colors.test.ts`                                                                                                                      | 主题 token                                                      |
| `src/main/windows/`                                     | `shell-window-state.test.ts`、`main-window-load.test.ts`、`login-window-navigation.test.ts`                                                                                     | 窗口状态 + 登录窗                                               |
| `src/main/updater/`                                     | `updater-adapter.test.ts`、`updater-controller.test.ts`                                                                                                                         | 更新器                                                          |
| `src/main/perf-governor.ts`                             | `perf-governor.test.ts`、`perf-state.test.ts`                                                                                                                                   | PerfState 广播                                                  |
| `src/shared/lyrics/`                                    | `lyrics-parser.test.ts`                                                                                                                                                         | lrc/yrc/qrc 解析                                                |
| `src/preload/main.ts`                                   | `electron-ipc-security.test.ts`                                                                                                                                                 | 唯一 contextBridge 出口                                         |
| 任何 IPC 通道增删                                       | `electron-ipc-security.test.ts` + `server-boundary.test.ts`                                                                                                                     | 两个边界测试是 IPC/协议门面的守卫                               |
| `.github/workflows/release.yml`、`electron-builder.yml` | `release-configuration.test.ts`                                                                                                                                                 | 发布配置一致性                                                  |

跑单个文件：`pnpm vitest run tests/unit/<file>.test.ts`。快照需更新时先确认改动是有意的，再 `pnpm vitest run tests/unit/<file>.test.ts -u`。

**按影响面验证**（别无脑跑全量）：lint + format 全量（快）；typecheck 只跑改动触及的那套 tsconfig（改 renderer 跑 `tsconfig.web.json`，改 main/server/preload 跑 `tsconfig.node.json`，改 shared 才跑两套）；test 只跑上面的区域测试，只有跨区域改动才跑 `pnpm test` 全量。改了渲染层交互才跑 `pnpm test:e2e`（约 50s，CI 不跑 e2e）。完整判断见 [docs/development-workflow.md](docs/development-workflow.md)。

### 约束

- **玻璃组件必须经 `@/components/glass` 包装层**，业务代码 oxlint 禁止直接 import `react-glass-ui`（.oxlintrc.json `no-restricted-imports`，glass 目录自身豁免）。
- **全局玻璃设置控制范围**（设置 → 玻璃 → 滑块/取色器，通过 `glassStore` 写 CSS 变量到 `document.documentElement`）：仅控制三处 `GlassSurface`——左侧列表（`LibrarySheet` → `HoverEdgeSheet` edge=left）、右侧列表（`PlaylistDetailSheet` → `HoverEdgeSheet` edge=right）、设置面板（`SettingsPanel`）。其余 `GlassSurface` 各自携带固定 `glassConfig` 覆盖，不跟随全局设置：搜索栏（`SearchPanel` 搜索框，blur=50 / borderRadius=28 / innerLightBlur=50 / color=#fff / h-56px）、搜索结果浮窗（`SearchPanel` popover）、`GlassSelect` 下拉、`WallpaperEngineLibraryDialog`。
- shadcn 组件配置在 components.json（new-york 风格，CSS 变量在 `src/renderer/src/styles/shadcn.css`）。
- 更新发布固定 GitHub `hey-sm/FluxPlayer`。**tag 发布优先签名**：CI 在有 Windows Authenticode / macOS Developer ID 凭据时签名并验签；缺少凭据时自动跳过签名，仍产出未签名安装包并创建 Release（`.github/workflows/release.yml`），发版步骤见 [docs/releasing.md](docs/releasing.md)。图标源是 `resources/icon.svg`，`scripts/gen-icons.mjs` 生成 png（未接入 npm script，手动调用），macOS 的 icns 走 `pnpm icons:mac`。
- UI 文案用简体中文。

### 开发工作流

改动提交前的验证序列、提交规范、文档持续更新对照表、AI 多 agent 协作约定见 [docs/development-workflow.md](docs/development-workflow.md)。改完代码先按上面的"改动后的验证序列"跑区域测试，再按影响面跑 typecheck（只跑受影响的 tsconfig）+ lint + format，跨区域改动才跑全量 test。改了架构不变量或新增 IPC / provider / 测试守卫，同步更新本文件和对应文档。

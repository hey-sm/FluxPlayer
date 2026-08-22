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
pnpm typecheck        # 两套 tsconfig 都要过：tsconfig.node.json + tsconfig.web.json
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

注意：改动主进程/preload/server/shared 后必须 `pnpm typecheck` —— 它跑 node 和 web 两套配置，两个 tsconfig 只覆盖各自的 src 子树。`.npmrc` 已指向 npmmirror 镜像。

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

### 播放引擎

[src/renderer/src/playback/engine.ts](src/renderer/src/playback/engine.ts) 的 `PlaybackEngine` 是单例，**独占唯一 `HTMLAudioElement` 和所有异步播放状态机**。Zustand store（[src/renderer/src/stores/player.ts](src/renderer/src/stores/player.ts)）只是它的可观察 UI 投影和用户动作门面 —— 通过 `connect(port)` 注入 state 读写口，别在 store 里塞播放逻辑。高频进度用独立 `usePlaybackProgress` store 隔离，避免整树重渲染。引擎内建：`loadGeneration` 防竞态、20s 媒体加载超时（`MEDIA_LOAD_TIMEOUT_MS`）、试听 30s 截断、shuffle 环形游标。

注意这三件事**引擎不做**，别去找对应实现：音质降级发生在**服务端**（provider 内部按候选链逐档回退，见 [src/server/providers/netease/index.ts](src/server/providers/netease/index.ts) 的 qualities 循环），引擎侧只用 `isQualityDowngrade` 提示实际档位低于偏好；**没有跨 provider 自动换源**；**没有失败黑名单** —— `resolvePlayback` 一次失败即 `failPlayback` 进 error 态，同一首歌只提示一次。

### 视觉系统（Three.js）

- **单一 Stage**：`VisualStage`（[src/renderer/src/visual/stage.ts](src/renderer/src/visual/stage.ts)）持有唯一 renderer/scene/camera，所有子层共用它，绝不自建动画时钟。
- **单一 RAF**：全局 `ticker`（[src/renderer/src/perf/ticker.ts](src/renderer/src/perf/ticker.ts)）是**视觉循环**唯一的 `requestAnimationFrame` 注册表，受主进程 `PerfGovernor` 广播的 `PerfState` 约束（minimize/hide → background/suspended 降频）。视觉循环别自己开 RAF。例外只有两类：GSAP 自带 ticker（`@gsap/react` 是动画主干，刻意如此），以及一次性的非循环 RAF（如 dialog/sheet 的焦点还原）。已知有两处自建 RAF 节流绕过了 `PerfState`（`components/glass/store.ts`、`features/settings/WallpaperEngineLayer.tsx`），是待收敛的债，不是可效仿的先例。
- **动态背景**：`DynamicBackgroundManager` 只实例化 HTML Light / Caustic / Rain 中当前选中的一个，默认 Rain。三者共享 renderer/ticker；不再存在音频分析器、封面粒子或 legacy preset。Caustic 是 Shadertoy "Tileable Water Caustic" 的移植（青蓝水底 + 白色焦散脊，配色固定、`setAccentColor` 刻意空实现）；Rain 是 Shadertoy "Heartfelt" 的移植（CC BY-NC-SA 3.0，雨打玻璃 + 心形故事自动循环、移除了全部鼠标交互、iChannel0 使用随项目分发的 Pexels 照片）。构图参考与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- **React 边界**：`StageCanvas` 只传入 `backgroundEffect`、启用状态和歌词交互参数；自定义图片/视频背景启用时释放动态背景，但保留歌词场景。
- **上游许可**：React Bits 适配代码保留来源注释，许可证全文与依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

### 测试约定

- 单测环境 `node`（vitest.config.ts），provider 映射有 `tests/unit/__snapshots__` 快照 + `tests/fixtures` 录制夹具（`pnpm record:fixtures` 重录）。
- e2e 起真实 Electron（`tests/e2e/electron.fixture.ts`），`FLUX_E2E=1` 时 [src/main/e2e-network-guard.ts](src/main/e2e-network-guard.ts) 会 monkey-patch http/https/fetch 阻断一切非 loopback 请求；音乐请求靠 fixture 注入。`workers: 1`，非并行。
- 有专门的边界测试：`server-boundary.test.ts`、`electron-ipc-security.test.ts`、`netease-sdk-allowlist.test.ts` —— 动 IPC/协议/SDK 门面时先看它们。

### 约束

- **玻璃组件必须经 `@/components/glass` 包装层**，业务代码 oxlint 禁止直接 import `react-glass-ui`（.oxlintrc.json `no-restricted-imports`，glass 目录自身豁免）。
- **全局玻璃设置控制范围**（设置 → 玻璃 → 滑块/取色器，通过 `glassStore` 写 CSS 变量到 `document.documentElement`）：仅控制三处 `GlassSurface`——左侧列表（`LibrarySheet` → `HoverEdgeSheet` edge=left）、右侧列表（`PlaylistDetailSheet` → `HoverEdgeSheet` edge=right）、设置面板（`SettingsPanel`）。其余 `GlassSurface` 各自携带固定 `glassConfig` 覆盖，不跟随全局设置：搜索栏（`SearchPanel` 搜索框，blur=50 / borderRadius=28 / innerLightBlur=50 / color=#fff / h-56px）、搜索结果浮窗（`SearchPanel` popover）、`GlassSelect` 下拉、`WallpaperEngineLibraryDialog`。
- shadcn 组件配置在 components.json（new-york 风格，CSS 变量在 `src/renderer/src/styles/shadcn.css`）。
- 更新发布固定 GitHub `hey-sm/FluxPlayer`。**tag 发布优先签名**：CI 在有 Windows Authenticode / macOS Developer ID 凭据时签名并验签；缺少凭据时自动跳过签名，仍产出未签名安装包并创建 Release（`.github/workflows/release.yml`），发版步骤见 [docs/releasing.md](docs/releasing.md)。图标源是 `resources/icon.svg`，`scripts/gen-icons.mjs` 生成 png（未接入 npm script，手动调用），macOS 的 icns 走 `pnpm icons:mac`。
- UI 文案用简体中文。
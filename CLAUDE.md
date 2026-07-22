# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

FluxPlayer 是一个 Electron + React 桌面音乐播放器，聚合网易云音乐与 QQ 音乐两个 provider，核心特色是基于 Three.js 音频响应式视觉背景。使用 pnpm、electron-vite、oxlint/oxfmt（非 ESLint/Prettier）、Vitest + Playwright。

## Commands

```bash
pnpm dev              # electron-vite 开发（HMR）
pnpm build            # 三进程构建到 out/
pnpm start            # electron-vite preview（预览已构建产物）
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

[src/renderer/src/playback/engine.ts](src/renderer/src/playback/engine.ts) 的 `PlaybackEngine` 是单例，**独占唯一 `HTMLAudioElement` 和所有异步播放状态机**。Zustand store（[src/renderer/src/stores/player.ts](src/renderer/src/stores/player.ts)）只是它的可观察 UI 投影和用户动作门面 —— 通过 `connect(port)` 注入 state 读写口，别在 store 里塞播放逻辑。高频进度用独立 `usePlaybackProgress` store 隔离，避免整树重渲染。引擎内建：`loadGeneration` 防竞态、音质自动降级重试（`tryQualityRetry`）、跨 provider 自动换源（`tryAlternateSource`）、失败黑名单、试听 30s 截断、shuffle 环形游标。

### 视觉系统（Three.js）

- **单一 Stage**：`VisualStage`（[src/renderer/src/visual/stage.ts](src/renderer/src/visual/stage.ts)）持有唯一 renderer/scene/camera，所有子层共用它，绝不自建动画时钟。
- **单一状态桥**：React → 视觉引擎的**唯一**接口是 `visualBus`（[src/renderer/src/visual/bus.ts](src/renderer/src/visual/bus.ts)）的 `VisualSnapshot`，同步 patch 保证每帧观测到一致快照。
- **单一 RAF**：全局 `ticker`（[src/renderer/src/perf/ticker.ts](src/renderer/src/perf/ticker.ts)）是唯一 `requestAnimationFrame` 注册表，受主进程 `PerfGovernor` 广播的 `PerfState` 约束（minimize/hide → background/suspended 降频）。视觉循环别自己开 RAF。
- **preset 分两类**：`preset 0-5`（粒子着色器，legacy）由 stage 直接渲染；`preset 7-10`（NEBULA/CRYSTAL/SKYLINE/CINEMATIC_VISTA）是 `MusicBackgroundManager` 管的独立背景对象。两个 registry 分别是 [visual/presets/registry.ts](src/renderer/src/visual/presets/registry.ts)（相机/过渡定义）和 [visual/backgrounds/registry.ts](src/renderer/src/visual/backgrounds/registry.ts)（背景实例工厂）。`visual/**` 目录被 oxfmt 忽略（保留 legacy 移植格式）。

### 测试约定

- 单测环境 `node`（vitest.config.ts），provider 映射有 `tests/unit/__snapshots__` 快照 + `tests/fixtures` 录制夹具（`pnpm record:fixtures` 重录）。
- e2e 起真实 Electron（`tests/e2e/electron.fixture.ts`），`FLUX_E2E=1` 时 [src/main/e2e-network-guard.ts](src/main/e2e-network-guard.ts) 会 monkey-patch http/https/fetch 阻断一切非 loopback 请求；音乐请求靠 fixture 注入。`workers: 1`，非并行。
- 有专门的边界测试：`server-boundary.test.ts`、`electron-ipc-security.test.ts`、`netease-sdk-allowlist.test.ts` —— 动 IPC/协议/SDK 门面时先看它们。

### 约束

- **玻璃组件必须经 `@/components/glass` 包装层**，业务代码 oxlint 禁止直接 import `react-glass-ui`（.oxlintrc.json `no-restricted-imports`，glass 目录自身豁免）。
- shadcn 组件配置在 components.json（new-york 风格，CSS 变量在 `src/renderer/src/styles/shadcn.css`）。
- 更新发布固定 GitHub `hey-sm/FluxPlayer`；未签名，release 文档需标 SmartScreen 风险。图标源是 `resources/icon.svg`，`scripts/gen-icons.mjs` 生成 png。
- UI 文案用简体中文。

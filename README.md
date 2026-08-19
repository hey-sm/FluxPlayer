<div align="center">

# FluxPlayer

**沉浸式桌面音乐播放器**

聚合网易云音乐与 QQ 音乐 · Light Rays / HTML Light / Galaxy 动态背景 · 隐私优先的进程隔离架构

`Electron 42` · `React 19` · `Three.js` · `TypeScript` · `Vite 8`

</div>

---

## 目录

- [简介](#简介)
- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [可用脚本](#可用脚本)
- [项目结构](#项目结构)
- [架构总览](#架构总览)
  - [进程分层](#进程分层)
  - [数据流：一次播放请求的完整路径](#数据流一次播放请求的完整路径)
  - [安全边界](#安全边界)
  - [播放引擎](#播放引擎)
  - [视觉系统](#视觉系统)
  - [性能治理](#性能治理)
- [Provider 抽象](#provider-抽象)
- [测试策略](#测试策略)
- [构建与发布](#构建与发布)
- [开发约定](#开发约定)
- [许可证](#许可证)

---

## 简介

FluxPlayer 是一款基于 Electron 的桌面音乐播放器。它把网易云音乐和 QQ 音乐两个 provider 聚合到统一的搜索、歌单、播放体验里，并使用 Three.js 呈现动态背景与同步 3D 歌词。

与常见的"内嵌网页壳"式播放器不同，FluxPlayer 的设计出发点是**进程隔离与隐私**：渲染进程完全不具备网络与凭据能力，所有上游请求、cookie、播放地址都被限制在 Electron 主进程内，渲染层只能拿到不透明的媒体句柄。

## 核心特性

- **双 provider 聚合**：网易云 / QQ 音乐统一搜索、歌单、我喜欢、逐字歌词。
- **多档音质**：超清母带 / 高清臻音 / 无损 / 极高 / 标准，跨 provider 归一化。
- **明确的失败反馈**：播放地址不可用时保留当前队列并展示原因，由用户手动重试或切歌；试听片段在 30 秒处截断。
- **动态背景与 3D 歌词**：内置 Light Rays 光线、HTML Light 吊灯与 Galaxy 螺旋星系背景，歌词继续使用 Three.js 网格渲染并支持旋转、拖拽和缩放。
- **全局液态玻璃**：左右栏、PlayerBar、搜索、设置与浮层统一使用可实时调节和持久化的 react-glass-ui 配置。
- **自定义背景**：支持导入本地图片/视频，以及 Wallpaper Engine 视频项目。
- **系统媒体集成**：Media Session（系统媒体控制中心 / 键盘媒体键）。
- **自动更新**：基于 electron-updater，GitHub 发布通道。
- **隐私优先**：凭据经系统 `safeStorage` 加密落盘，上游地址永不出主进程。

## 技术栈

| 层         | 选型                                                                      |
| ---------- | ------------------------------------------------------------------------- |
| 桌面运行时 | Electron 42                                                               |
| 构建       | electron-vite 5 / Vite 8 / oxc minify                                     |
| UI         | React 19 · Tailwind CSS 4 · Radix UI · shadcn (new-york) · react-glass-ui |
| 状态       | Zustand 5 · TanStack Query 5                                              |
| 视觉       | Three.js 0.185                                                            |
| 校验       | Zod 4（IPC 入参 schema）                                                  |
| 工具链     | oxlint · oxfmt（非 ESLint/Prettier）                                      |
| 测试       | Vitest 3（单测）· Playwright（e2e，真实 Electron）                        |
| 打包       | electron-builder（Windows NSIS · macOS DMG/ZIP · Linux AppImage/deb）     |
| 包管理     | pnpm                                                                      |

## 快速开始

前置：Node.js ≥ 20、pnpm。仓库 `.npmrc` 已指向 npmmirror 镜像（含 Electron 二进制镜像）。

```bash
pnpm install          # 安装依赖
pnpm dev              # 启动开发（Electron + HMR）
```

首次登录：在设置面板里分别登录网易云 / QQ 账号（弹出各自的官方登录窗口，凭据由主进程加密保存）。

## 可用脚本

| 命令                                | 说明                                                               |
| ----------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev` / `pnpm start`           | electron-vite 开发模式，渲染层 CSS/TSX HMR                         |
| `pnpm build`                        | 构建 main / preload / renderer 三进程产物到 `out/`                 |
| `pnpm preview`                      | 启动时执行一次构建后预览静态 `out/` 产物，不提供运行时源码热更新   |
| `pnpm typecheck`                    | 类型检查（**同时**跑 `tsconfig.node.json` 与 `tsconfig.web.json`） |
| `pnpm lint`                         | oxlint 静态检查                                                    |
| `pnpm format` / `pnpm format:write` | oxfmt 校验 / 写入                                                  |
| `pnpm test`                         | Vitest 全量单测                                                    |
| `pnpm test:e2e`                     | 先 build 再跑 Playwright（真实 Electron）                          |
| `pnpm smoke`                        | 无头启动冒烟测试（验证窗口加载、无本地 TCP 监听）                  |
| `pnpm record:fixtures`              | 重新录制 provider 测试夹具                                         |
| `pnpm build:win`                    | 打 Windows NSIS 安装包到 `dist/`                                   |
| `pnpm build:mac`                    | 在 macOS 打 x64/arm64 DMG 与 ZIP 到 `dist/`                        |
| `pnpm build:linux`                  | 在 Linux 打 x64 AppImage 与 deb 到 `dist/`                         |

> 开发界面时请使用 `pnpm dev` 或 `pnpm start`。`pnpm preview` 默认只在启动时构建一次，运行期间修改源码不会热更新；需要重启 `preview`，或先执行 `pnpm build` 再使用 `electron-vite preview --skipBuild` 查看新的静态产物。
> | `pnpm build:win:dir` | 免安装目录版本 |

**跑单个测试：**

```bash
pnpm vitest run tests/unit/player-failure.test.ts    # 指定文件
pnpm vitest run -t "用例名片段"                          # 按名字过滤
pnpm exec playwright test tests/e2e/player.spec.ts    # 单个 e2e（需先 pnpm build）
```

> 改动 `src/main`、`src/preload`、`src/server`、`src/shared` 后务必跑 `pnpm typecheck`——两套 tsconfig 各覆盖不同 src 子树，只跑一套会漏掉另一侧的类型错误。

## 项目结构

```
src/
├── main/                  # Electron 主进程（唯一能接触网络/凭据的层）
│   ├── index.ts           # 应用入口：生命周期、单例锁、协议/IPC/更新器注册
│   ├── ipc.ts             # 所有 IPC handler + secureHandle 安全包裹
│   ├── music-service.ts   # server 层到主进程播放边界的适配器
│   ├── credentials.ts     # SafeCredentialStore（DPAPI 加密 + 崩溃恢复）
│   ├── perf-governor.ts   # 性能状态唯一事实源（Chromium 节流 + 广播）
│   ├── protocols/         # flux:// 与 flux-media:// 自定义协议、音频句柄仓库
│   ├── background/         # 自定义背景 / Wallpaper Engine 导入
│   ├── updater/           # electron-updater 适配 + controller
│   └── windows/           # 主窗口、provider 登录窗口
├── preload/main.ts        # 唯一 contextBridge 出口（编译为 CJS）
├── server/                # provider 实现（进程无关纯逻辑）
│   ├── music/             # MusicService：provider 分发编排
│   ├── providers/
│   │   ├── netease/       # 网易云：SDK allowlist 门面 + 映射
│   │   └── qq/            # QQ：client / session / mappers
│   └── util/              # cookies / http / unknown 解析
├── shared/                # 跨进程契约（无运行时副作用）
│   ├── ipc-contract.ts    # IPC 通道常量 + 类型
│   ├── music-contract.ts  # 音乐 API 契约 + 错误码
│   ├── music-schema.ts    # Zod 入参校验 schema
│   ├── models.ts          # UnifiedSong / QualityLevel 等领域模型
│   └── lyrics/            # 歌词解析（lrc/yrc/qrc）
└── renderer/src/          # React UI（无网络/凭据能力）
    ├── App.tsx            # 根组件：布局 + 生命周期 hooks
    ├── api.ts             # window.fluxDesktop 桥接 + 错误码映射
    ├── stores/            # Zustand：player / auth
    ├── playback/          # PlaybackEngine（播放状态机核心）
    ├── visual/            # Three.js 动态背景与 3D 歌词（stage/backgrounds/lyrics3d-mesh）
    ├── perf/ticker.ts     # 全局唯一 RAF 注册表
    ├── features/          # 业务模块：search / library / playlist / lyrics / settings
    ├── components/        # 通用组件（glass 全局配置与唯一适配层 / ui / shell / player）
    └── theme/             # 主题系统

tests/
├── unit/                  # Vitest 单测（含 __snapshots__ 快照）
├── e2e/                   # Playwright（真实 Electron）
├── fixtures/              # provider 录制夹具
└── helpers/               # 测试工具
```

## 架构总览

### 进程分层

FluxPlayer 严格遵循 Electron 三进程模型，并额外抽出「共享契约层」与「provider 纯逻辑层」，路径别名固定：

| 别名              | 指向               | 角色                                     |
| ----------------- | ------------------ | ---------------------------------------- |
| `@shared`         | `src/shared`       | 跨进程契约（renderer 与 main 都 import） |
| `@server`         | `src/server`       | provider 实现（被 main 适配调用）        |
| `@` / `@renderer` | `src/renderer/src` | 渲染层                                   |

```
┌──────────────────────────────────────────────────────────┐
│  Renderer (React)  ── 无网络、无凭据、无 Node             │
│    stores ─ playback engine ─ visual system               │
│              │                                            │
│              │  window.fluxDesktop（唯一出口）             │
└──────────────┼────────────────────────────────────────────┘
               │  contextBridge (preload/main.cjs)
┌──────────────┼────────────────────────────────────────────┐
│  Main (Electron)                                          │
│    ipc.ts ── secureHandle（origin 校验 + zod 解析）        │
│      │                                                    │
│      ├─ MusicService (server) ── netease / qq providers   │
│      ├─ AudioHandleStore ── flux-media:// 句柄             │
│      ├─ SafeCredentialStore ── DPAPI 加密落盘             │
│      ├─ PerfGovernor ── 性能状态广播                       │
│      └─ UpdaterController / CustomBackgroundService       │
└────────────────────────────────────────────────────────────┘
```

关键点：`src/server` 是**进程无关**的纯逻辑，通过 `createMainMusicService`（[src/main/music-service.ts](src/main/music-service.ts)）被主进程适配后调用，这让 provider 逻辑可以脱离 Electron 单测。

### 数据流：一次播放请求的完整路径

以「点击一首歌播放」为例，展示各层如何协作、上游地址如何被隔离：

```
1. UI 点击
   → usePlayer.play(song)  [renderer/stores/player.ts]
       委托给 →

2. PlaybackEngine.loadIndex()  [renderer/playback/engine.ts]
   → musicClient.resolvePlayback({ song, quality })
       经 window.fluxDesktop.music → IPC 'flux:music:resolve-playback'

3. secureHandle 校验  [main/ipc.ts]
   → isPrimaryRenderer(event)  拒绝非主窗口/非法 origin
   → zod schema 解析入参
   → MusicService.resolvePlayback()

4. Provider 解析  [server/providers/netease|qq]
   → 用主进程持有的 cookie 请求上游
   → 返回 MainPlaybackResource { upstreamUrl, upstreamHeaders, ... }

5. 主进程句柄替换  [main/ipc.ts]  ★ 核心隔离点
   → audioHandles.create({ url: upstreamUrl, headers })  → 生成随机句柄
   → 返回给 renderer 的 url = 'flux-media://audio/<handle>'
       （上游 URL 和 cookie 到此为止，绝不过 IPC）

6. 播放  [renderer/playback/engine.ts]
   → audio.src = 'flux-media://audio/<handle>'
   → 浏览器请求该 URL

7. 协议处理  [main/protocols/media.ts]
   → 按句柄取回真实 upstream，用主进程 net.fetch 代理
   → 透传 Range、重写响应头、限制 CORS 到 flux://app
```

失败时（受限/需登录/无版权），引擎保留当前队列和歌曲上下文，展示具体原因，并等待用户手动重试或切歌。

### 安全边界

以下是改动 IPC / 媒体 / provider 路径时**必须保持的不变量**：

1. **上游 URL 与 cookie 绝不过 IPC。** provider 返回的 `upstreamUrl` 在主进程用 `AudioHandleStore`（LRU + 30 分钟 TTL）换成不透明句柄，渲染层永远只见 `flux-media://` URL。
2. **每个 IPC handler 经 `secureHandle` 包裹**：先校验 sender 是主窗口的主 frame 且 origin 匹配（否则抛 `UNAUTHORIZED_RENDERER`），再用 Zod schema 解析入参（否则抛 `INVALID_REQUEST`）。新增 IPC 通道必须走这条路径，schema 定义在 [src/shared/music-schema.ts](src/shared/music-schema.ts)。
3. **自定义协议 + 主机 allowlist。** `flux://app` 加载渲染层，`flux-media://` 代理音频/封面。封面主机走 `COVER_HOST_SUFFIXES` allowlist，响应头被过滤重写，`Access-Control-Allow-Origin` 固定为 `flux://app`。
4. **网易云 SDK 走固定门面。** [src/server/providers/netease/sdk.ts](src/server/providers/netease/sdk.ts) 只 deep-import `NCM_ENDPOINT_ALLOWLIST` 里明确列出的模块，绝不 import 包根、不扫描模块目录——缩小 SDK 攻击面。新增端点需显式加进 loader map（有 `netease-sdk-allowlist.test.ts` 守护）。
5. **凭据加密落盘。** `SafeCredentialStore` 使用 Electron `safeStorage`（Windows DPAPI / macOS Keychain / Linux secret store）加密，带读回校验、replacement journal 崩溃恢复，只接受密文、不降级明文写入。
6. **e2e 网络防护。** `FLUX_E2E=1` 时 [src/main/e2e-network-guard.ts](src/main/e2e-network-guard.ts) monkey-patch http/https/fetch，阻断一切非 loopback 请求；测试数据靠 fixture 注入。
7. **禁用 webview**、单实例锁、`will-attach-webview` 拦截等在 [src/main/index.ts](src/main/index.ts) 中固定。

### 播放引擎

`PlaybackEngine`（[src/renderer/src/playback/engine.ts](src/renderer/src/playback/engine.ts)）是单例，**独占唯一 `HTMLAudioElement` 与所有异步播放状态转换**。设计要点：

- **Zustand 只是投影。** player store 通过 `connect(port)` 给引擎注入 state 读写口，store 本身不含播放逻辑——它只是引擎状态的可观察 UI 投影 + 用户动作门面。别把播放逻辑写进 store。
- **进度隔离。** 高频进度更新走独立的 `usePlaybackProgress` store，避免每秒触发整棵组件树重渲染。
- **竞态防护。** `loadGeneration` 计数器保证过期的异步解析结果不会覆盖新播放。
- **单源失败语义。** 每次播放只解析当前歌曲所属 provider；失败后保持当前队列和索引，不自动换源或跳歌。
- **播放模式。** sequence / repeat-one / shuffle，shuffle 用环形游标 + 洗牌轮次，支持双向。
- **试听截断。** 试听资源在 30s 处强制暂停。
- **系统集成。** 绑定 Media Session（系统媒体控制、键盘媒体键）。

### 视觉系统

Three.js 动态背景遵循「单一实例」原则，避免资源泄漏与多时钟竞争：

- **单一 Stage** —— `VisualStage`（[src/renderer/src/visual/stage.ts](src/renderer/src/visual/stage.ts)）持有唯一的 renderer / scene / camera，所有子层（歌词层、背景管理器）共用它。
- **单一 RAF** —— 全局 `ticker`（[src/renderer/src/perf/ticker.ts](src/renderer/src/perf/ticker.ts)）是唯一的 `requestAnimationFrame` 注册表，所有视觉循环都注册到它，受主进程 `PerfState` 约束降频。视觉代码不应自建动画时钟。
- **三种动态背景** —— Light Rays 使用全屏 shader；HTML Light 使用可拖拽物理吊灯、暖色聚光灯和程序化承光平面；Galaxy 使用 8 万颗加色混合星点组成的螺旋星系（固定种子、白色核球 + 随主题色微调的蓝色外圈、极慢自转）。三者由 `DynamicBackgroundManager` 懒加载并在切换时释放旧 GPU 资源。
- **独立歌词数据流** —— `stageLyricsChannel` 只向 3D 歌词层发布当前歌词窗口和播放位置；动态背景不接入音频频谱。
- **自定义背景优先** —— 本地图片、视频或 Wallpaper Engine 背景启用时释放动态 shader，3D 歌词仍由同一个 Stage 渲染。
- **单层液态玻璃** —— `components/glass` 是配置、持久化、CSS 变量和 `react-glass-ui` 的唯一入口；设置面板“玻璃”Tab 实时控制所有真实表面。实现和动画禁令见 [docs/liquid-glass-system.md](docs/liquid-glass-system.md)。

> `src/renderer/src/visual/**` 被 oxfmt 忽略以保留 shader 排版，改动视觉代码仍需通过 typecheck 与 lint。

### 性能治理

- 主进程 `PerfGovernor`（[src/main/perf-governor.ts](src/main/perf-governor.ts)）是性能状态的**唯一事实源**：监听窗口 minimize/restore/show/hide/focus/blur，去重后动态开关 Chromium 后台节流，并把 `PerfState`（active / background / suspended）经 IPC 广播给渲染层。
- 渲染层 `Ticker` 据此决定哪些回调继续跑：`suspended` 全停，`background` 仅 `runInBackground` 回调运行，`active` 全跑。可见性变化仅用于重新 evaluate，最终状态以主进程广播为准（不自行把失焦降级）。

## Provider 抽象

- [src/server/music/index.ts](src/server/music/index.ts) 的 `MusicService.select()` 是 provider 分发的**唯一 switch**——新增第三个 provider 从这里入手。
- 每个 provider 把上游响应映射为统一模型 `UnifiedSong` / `UnifiedPlaylist`（[src/shared/models.ts](src/shared/models.ts)）。
- **音质等级**统一为 `QualityLevel` 五档（`jymaster` / `hires` / `lossless` / `exhigh` / `standard`），`normalizeQualityPreference` 负责把各家别名（flac/sq/320k/master…）归一。QQ 与网易云各有音质候选表和自动降级顺序。
- **错误码**统一为 `MusicErrorCode` 枚举（[src/shared/music-contract.ts](src/shared/music-contract.ts)），渲染层 [api.ts](src/renderer/src/api.ts) 把它映射成中文产品文案，不泄漏 provider 诊断细节。

## 测试策略

| 类型 | 环境                       | 说明                                                                           |
| ---- | -------------------------- | ------------------------------------------------------------------------------ |
| 单测 | Vitest（node 环境）        | provider 映射、播放逻辑、协议、安全边界；`tests/unit/__snapshots__` 存映射快照 |
| 夹具 | —                          | `tests/fixtures` 录制真实上游响应，`pnpm record:fixtures` 重录                 |
| e2e  | Playwright + 真实 Electron | `tests/e2e/electron.fixture.ts` 起真实应用，音乐请求靠 fixture 注入            |
| 冒烟 | `pnpm smoke`               | 无头启动，校验窗口能加载、无本地 TCP                                           |

重点边界测试（改相关代码前先读）：

- `server-boundary.test.ts` —— server 层不得泄漏上游细节到跨进程契约
- `electron-ipc-security.test.ts` —— `secureHandle` / origin 校验
- `netease-sdk-allowlist.test.ts` —— SDK 门面 allowlist 完整性
- `player-*.test.ts` —— 播放失败反馈 / 音质 / 模式 / 进度隔离

e2e 下 `FLUX_E2E=1` 触发网络防护（阻断非 loopback），Playwright 配置 `workers: 1` 非并行。

## 构建与发布

- 产物结构：`out/main`（ESM）、`out/preload`（**CJS `.cjs`**，ESM preload 会导致页面加载静默悬死）、`out/renderer`（oxc 压缩）。
- 本地打包：Windows 使用 `pnpm build:win`，macOS 使用 `pnpm build:mac`，Linux 使用 `pnpm build:linux`。
- 推送 `main` 自动生成三平台 Actions Artifacts；推送与 `package.json` 版本一致的 `v*` 标签后自动创建 GitHub Release。
- 标签发布强制校验 Windows Authenticode 签名和 macOS Developer ID 签名/公证；所需 Secrets 与发版步骤见 [docs/releasing.md](docs/releasing.md)。
- 更新通道固定 GitHub `hey-sm/FluxPlayer`。Windows NSIS、macOS ZIP 和 Linux AppImage 会同时发布对应的更新元数据。
- 图标：源文件 `resources/icon.svg`；Windows/Linux 使用 `icon.png`，macOS 构建时生成 `icon.icns`。

## 开发约定

- **格式化/校验用 oxfmt + oxlint**，不是 Prettier/ESLint。提交前 `pnpm format:write && pnpm lint`。
- **玻璃组件必须经 `@/components/glass` 的 `GlassSurface` 使用**；业务代码不得直接 import `react-glass-ui`、嵌套真实玻璃或动态 transform 玻璃祖先。完整约定见 [docs/liquid-glass-system.md](docs/liquid-glass-system.md)。
- shadcn 组件遵循 components.json（new-york 风格，CSS 变量），UI 图标用 lucide-react。
- **改动多进程共享代码后跑 `pnpm typecheck`**（两套 tsconfig 都要过）。
- UI 文案使用简体中文。
- 提交前建议本地跑一遍 `pnpm test`；动到主进程/协议时再补 `pnpm smoke`。

## 许可证

FluxPlayer 原创代码采用 [MIT License](LICENSE) 开源。项目包含的第三方代码和依赖仍遵循各自的许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

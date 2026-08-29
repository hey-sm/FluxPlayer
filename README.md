<div align="center">

# FluxPlayer

**沉浸式桌面音乐播放器**

聚合网易云音乐与 QQ 音乐 · HTML Light / 水纹焦散 / 雨窗 动态背景 · 隐私优先的进程隔离架构

`Electron 42` · `React 19` · `Three.js` · `TypeScript` · `Vite 8`

</div>

---

## 简介

FluxPlayer 是一款基于 Electron 的桌面音乐播放器。它把网易云音乐和 QQ 音乐两个 provider 聚合到统一的搜索、歌单、播放体验里，并使用 Three.js 呈现动态背景与同步 3D 歌词。

与常见的"内嵌网页壳"式播放器不同，FluxPlayer 的设计出发点是**进程隔离与隐私**：渲染进程完全不具备网络与凭据能力，所有上游请求、cookie、播放地址都被限制在 Electron 主进程内，渲染层只能拿到不透明的媒体句柄。

## 核心特性

- **双 provider 聚合**：网易云 / QQ 音乐统一搜索、歌单、我喜欢、逐字歌词。
- **多档音质**：超清母带 / 高清臻音 / 无损 / 极高 / 标准，跨 provider 归一化。
- **明确的失败反馈**：播放地址不可用时保留当前队列并展示原因，由用户手动重试或切歌；试听片段在 30 秒处截断。
- **动态背景与 3D 歌词**：内置 HTML Light 吊灯、水纹焦散与雨窗背景，歌词使用 Three.js 网格渲染并支持旋转、拖拽和缩放。
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
| 打包       | electron-builder（Windows NSIS · macOS DMG/ZIP）                          |
| 包管理     | pnpm                                                                      |

## 快速开始

前置：Node.js ≥ 20、pnpm。仓库 `.npmrc` 已指向 npmmirror 镜像（含 Electron 二进制镜像）。

```bash
pnpm install          # 安装依赖
pnpm dev              # 启动开发（Electron + HMR）
```

首次登录：在设置面板里分别登录网易云 / QQ 账号（弹出各自的官方登录窗口，凭据由主进程加密保存）。

> **Agent skills**：项目用的 AI 编码 skill 声明在 [`skills-lock.json`](skills-lock.json)（4 个：electron-development / gsap-core / ui-ux-pro-max / vercel-react-best-practices）。`.agents/skills/` 是安装产物，已从仓库排除——clone 后由各自的 agent 工具按锁文件重建，如同 `pnpm install` 按 lockfile 重建 `node_modules`。

## 常用脚本

```bash
pnpm dev                # 开发模式（HMR）
pnpm build             # 三进程构建到 out/
pnpm typecheck         # 类型检查（同时跑 node + web + test 三套 tsconfig）
pnpm lint              # oxlint
pnpm format:write      # oxfmt 格式化
pnpm test              # Vitest 全量单测
pnpm test:e2e          # 先 build 再跑 Playwright（真实 Electron，约 50s）
pnpm smoke             # 无头冒烟：校验窗口加载、无本地 TCP
pnpm build:win         # Windows NSIS 安装包
pnpm build:mac         # macOS DMG/ZIP（x64 + arm64）
```

跑单个测试：

```bash
pnpm vitest run tests/unit/player-failure.test.ts    # 指定文件
pnpm vitest run -t "用例名片段"                          # 按名字过滤
```

> 改动 `src/main`、`src/preload`、`src/server`、`src/shared` 后务必跑 `pnpm typecheck`——三套 tsconfig 各覆盖不同 src 子树。改动后的完整验证序列见 [CLAUDE.md](CLAUDE.md)。

## 项目结构

```
src/
├── main/                  # Electron 主进程（唯一能接触网络/凭据的层）
│   ├── index.ts           # 应用入口：生命周期、单例锁、协议/IPC/更新器注册
│   ├── ipc.ts             # 所有 IPC handler + secureHandle 安全包裹
│   ├── credentials.ts     # SafeCredentialStore（DPAPI 加密 + 崩溃恢复）
│   ├── perf-governor.ts   # 性能状态唯一事实源（Chromium 节流 + 广播）
│   ├── protocols/         # flux:// 与 flux-media:// 自定义协议、音频句柄仓库
│   ├── background/        # 自定义背景 / Wallpaper Engine 导入
│   ├── updater/           # electron-updater 适配 + controller
│   └── windows/           # 主窗口、provider 登录窗口
├── preload/main.ts        # 唯一 contextBridge 出口（编译为 CJS）
├── server/                # provider 实现（进程无关纯逻辑，可脱离 Electron 单测）
│   ├── music/             # MusicService：provider 分发编排
│   └── providers/
│       ├── netease/       # 网易云：SDK allowlist 门面 + 映射
│       ├── qq/            # QQ：client / session / mappers
│       └── chksz/         # 聚合/解锁后端（直连兜底，非第三 provider）
├── shared/                # 跨进程契约（IPC 通道、zod schema、领域模型，无运行时副作用）
└── renderer/src/          # React UI（无网络/凭据能力，只经 window.fluxDesktop 走 IPC）
    ├── playback/          # PlaybackEngine（播放状态机核心）
    ├── visual/            # Three.js 动态背景与 3D 歌词
    ├── perf/ticker.ts     # 全局唯一 RAF 注册表
    ├── stores/            # Zustand：player / auth
    ├── features/          # 业务模块：search / library / playlist / lyrics / settings
    ├── components/        # 通用组件（glass / ui / shell / player）
    └── theme/             # 主题系统

tests/
├── unit/                  # Vitest 单测（含 __snapshots__ 快照）
├── e2e/                   # Playwright（真实 Electron）
└── fixtures/              # provider 录制夹具
```

## 架构总览

### 进程分层

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
│      ├─ MusicService (server) ── netease / qq providers   │
│      ├─ AudioHandleStore ── flux-media:// 句柄             │
│      ├─ SafeCredentialStore ── DPAPI 加密落盘             │
│      └─ PerfGovernor ── 性能状态广播                       │
└────────────────────────────────────────────────────────────┘
```

`src/server` 是**进程无关**的纯逻辑，通过 `createMainMusicService` 被主进程适配后调用，provider 逻辑可脱离 Electron 单测。路径别名：`@shared` → `src/shared`，`@server` → `src/server`，`@`/`@renderer` → `src/renderer/src`。

### 数据流：一次播放请求

```
1. UI 点击 → usePlayer.play(song)
2. PlaybackEngine → window.fluxDesktop.music.resolvePlayback → IPC
3. secureHandle 校验 sender + zod 解析 → MusicService.resolvePlayback
4. Provider 用主进程 cookie 请求上游 → 返回 { upstreamUrl, ... }
5. 主进程句柄替换 ★核心隔离点
   → audioHandles.create() 生成随机句柄
   → renderer 只拿到 flux-media://audio/<handle>（上游 URL 绝不过 IPC）
6. audio.src = 'flux-media://audio/<handle>'
7. 协议处理器按句柄取回真实上游，代理请求、重写响应头、限制 CORS
```

失败时引擎保留当前队列和歌曲上下文，展示具体原因，等待用户手动重试或切歌。

### 安全边界

改动 IPC / 媒体 / provider 路径时必须保持的不变量（完整 5 条见 [CLAUDE.md](CLAUDE.md)）：

1. **上游 URL / cookie 绝不过 IPC**——主进程换成不透明 `flux-media://` 句柄再回传。
2. **每个 IPC handler 经 `secureHandle`**——origin 校验 + zod 解析。
3. **自定义协议 + 主机 allowlist**——`flux-media://` 代理音频/封面，响应头重写。
4. **网易云 SDK 走固定 allowlist 门面**——只 deep-import 明确列出的模块。
5. **凭据加密落盘**——`safeStorage`（DPAPI / Keychain），只接受密文。

### 视觉系统

- **单一 Stage**：`VisualStage` 持有唯一 renderer/scene/camera，所有子层共用。
- **单一 RAF**：全局 `ticker` 是唯一的 `requestAnimationFrame` 注册表，受 `PerfState` 约束降频。
- **三种动态背景**：HTML Light 吊灯 / 水纹焦散 / 雨窗（Shadertoy 移植），三选一，切换时释放旧 GPU 资源。
- **3D 歌词**：独立数据流，不接入音频频谱；自定义背景启用时释放动态 shader，歌词仍由同一 Stage 渲染。

### 性能治理

主进程 `PerfGovernor` 是性能状态唯一事实源：监听窗口 minimize/hide/focus，广播 `PerfState`（active / background / suspended）。渲染层 `Ticker` 据此决定哪些回调继续跑。

## 深度文档

| 文档                                                         | 内容                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                                       | AI agent 主上下文：架构不变量、改动后的验证序列、安全边界、chksz 编排 |
| [docs/development-workflow.md](docs/development-workflow.md) | 提交前验证流程、commit 规范、文档持续更新对照表、多 agent 协作约定    |
| [docs/releasing.md](docs/releasing.md)                       | 发版两步、CI 流水线、签名配置、标签回退                               |
| [docs/liquid-glass-system.md](docs/liquid-glass-system.md)   | 液态玻璃系统：配置源、默认值、CSS 变量、动画禁令                      |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)             | 第三方代码与素材许可                                                  |

## 测试

| 类型 | 环境                       | 说明                                                           |
| ---- | -------------------------- | -------------------------------------------------------------- |
| 单测 | Vitest（node）             | provider 映射、播放逻辑、协议、安全边界；`__snapshots__` 快照  |
| 夹具 | —                          | `tests/fixtures` 录制真实上游响应，`pnpm record:fixtures` 重录 |
| e2e  | Playwright + 真实 Electron | 只在本地跑（依赖 GPU），发版前 `pnpm test:e2e` 一次            |
| 冒烟 | `pnpm smoke`               | 无头启动，校验窗口加载、无本地 TCP                             |

重点边界测试：`server-boundary` / `electron-ipc-security` / `netease-sdk-allowlist` —— 动 IPC/协议/SDK 门面时先看它们。

## 构建与发布

- 本地打包：`pnpm build:win`（Windows NSIS）/ `pnpm build:mac`（macOS DMG/ZIP）。不发 Linux。
- 推送 `main` 不触发 CI；推送与 `package.json` 版本一致的 `v*` 标签才跑校验、打包并创建 GitHub Release。
- 标签发布优先签名：有凭据时签名验签，无凭据时跳过签名仍产出安装包。
- 完整发版步骤见 [docs/releasing.md](docs/releasing.md)。

## 许可证

FluxPlayer 原创代码采用 [MIT License](LICENSE) 开源。项目包含的第三方代码和依赖仍遵循各自的许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 致谢

感谢 [Linux.do](https://linux.do) 社区。

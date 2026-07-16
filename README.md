# FluxPlayer

沉浸式桌面音乐播放器 —— Mineradio v1.1.1 的工程化重构版（React 重写，strangler 迁移完成后的独立仓库）。

- 版本：`2.0.0-alpha.1` · 许可证：GPL-3.0 · 平台：Windows（NSIS 安装包）
- 技术栈：electron-vite 5 · Electron 42 · React 19 · TypeScript · zustand · TanStack Query · Hono（本地 API 服务）· three 0.185.1

详细架构说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 功能概览

- **双音源**：网易云音乐 + QQ 音乐，统一歌曲模型；双平台并行搜索、跨平台自动换源兜底
- **粒子视觉舞台**：three.js 手写 shader 粒子舞台（封面粒子网格 + bloom），6 种视觉预设（丝绸/隧道/轨道/虚空/唱片/星河）+ 14 参数 DIY 控制台
- **舞台 3D 歌词**
- **实时音频分析**：captureStream 侧路实时 FFT
- **玻璃质感 UI**：6 套主题预设（含逐值复刻旧版的 classic-gold SVG 折射玻璃），16 项主题参数可调
- **自定义背景**：本地图片/视频，或直接导入 Wallpaper Engine 创意工坊视频壁纸
- **官网登录**：内嵌真实官网登录窗口，cookie 经 safeStorage（DPAPI）加密存储，零明文
- **性能状态机**：active/passive/background/suspended 四态治理，最小化时仅保留音频
- **其他**：逐字歌词（YRC）+ 翻译合并、全局快捷键、系统媒体控件、electron-updater 自动更新

## 目录结构

```
src/
├─ shared/     跨进程契约：IPC 通道、统一歌曲模型、性能状态机、歌词解析
├─ main/       Electron 主进程：窗口/登录窗口/IPC/性能治理/加密凭据/更新器/自定义背景
├─ preload/    main.ts（fluxDesktop 桥），CJS 输出
├─ server/     本地 API（Hono, 127.0.0.1:43110）：netease/qq providers、媒体代理、静态服务
└─ renderer/   React 应用：播放器/歌单/歌词/主题/视觉引擎（visual/）/玻璃组件
tests/
├─ unit/       vitest 单测（53 个文件，含 fixture 快照映射测试）
├─ e2e/        Playwright 驱动 Electron 的端到端（含网络守卫，真实音频播放验证）
└─ fixtures/   record-fixtures.mjs 录制的匿名化上游 API 响应
scripts/       冒烟测试、fixture 录制、图标生成、Electron 缓存填充等
```

## 快速开始

```powershell
pnpm install          # .npmrc 已配置 npmmirror 与 electron 二进制镜像
pnpm dev              # 开发模式（main/preload/renderer 三端 HMR + 本地 API）
```

其他常用命令：

```powershell
pnpm typecheck        # node + web 双 tsconfig 类型检查
pnpm test             # vitest 单测
pnpm test:e2e         # 构建后跑 Playwright E2E
pnpm lint             # oxlint
pnpm build            # electron-vite 构建到 out/
pnpm smoke            # 冒烟：沙盒启动 → 窗口加载 + /api/app/version 自检 → 自动退出
pnpm build:win        # NSIS 安装包（dist/）
```

### 环境变量

| 变量 | 作用 |
|---|---|
| `FLUX_SMOKE=1` | 冒烟测试模式（自检自退） |
| `FLUX_E2E=1` | E2E 模式（阻断非 loopback 网络、跳过单实例锁） |
| `STEAM_PATH` | 覆盖 Wallpaper Engine 扫描的 Steam 根目录 |

## 与旧版（Mineradio）的行为差异

- 手写更新/补丁系统已移除：`/api/update/*` 返回 `UPDATE_SYSTEM_REMOVED`，改用 electron-updater（GitHub Releases）
- 动态壁纸模式以 koffi + 新视觉引擎重做中；桌面 3D 歌词在 backlog（IPC 为兼容 stub）
- 播客域未迁移：对应端点返回可降级的空形状
- `/api/audio`、`/api/cover` 代理增加音源 CDN 域白名单，上游错误状态码原样透传
- Cookie 改为 safeStorage 加密存储（不再有明文 `.cookie` / `.qq-cookie` 文件）
- 登录窗口不再自动点击页面按钮，改为轮询登录 cookie（QQ 会自动 warmup 播放授权 `qm_keyst`）

## 图标

`resources/icon.svg` 为图标源。改动后运行 `node scripts/gen-icons.mjs` 重新生成 `resources/icon.png`（窗口图标 + electron-builder 自动转 ico）；renderer favicon 位于 `src/renderer/public/favicon.svg`。

## 本机网络备注

`@electron/get` 的 Node fetch 在部分网络下直连失败（curl 正常）。如果重装依赖后 Electron 二进制缺失：

```powershell
curl -L -o $env:TEMP\electron.zip "https://registry.npmmirror.com/-/binary/electron/<版本>/electron-v<版本>-win32-x64.zip"
curl -L -o $env:TEMP\SHASUMS256.txt "https://registry.npmmirror.com/-/binary/electron/<版本>/SHASUMS256.txt"
node scripts/seed-electron-cache.mjs $env:TEMP\electron.zip $env:TEMP\SHASUMS256.txt
node node_modules/electron/install.js
```

## 贡献须知

改代码前请先读 [CLAUDE.md](CLAUDE.md) 的"铁律"一节：粒子舞台 shader、3D 歌词、经典玻璃质感为逐字节搬迁的核心资产禁止重构；渲染层动画必须走全局 Ticker；three 锁 0.185.1；preload 必须 CJS。工作单元的完成定义（DoD，按改动范围分级）：typecheck + test 每次必做；动了 main/preload/server/shared 或构建配置再跑标准模式冒烟；非平凡 diff 做 code review；小步提交。

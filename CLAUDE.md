# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# FluxPlayer —— Claude 工作守则

FluxPlayer：沉浸式桌面音乐播放器（`2.0.0-alpha.1`，GPL-3.0），独立的沉浸式桌面音乐播放器。
技术栈：electron-vite 5 · Electron 42 · React 19 · TypeScript · zustand · TanStack Query · Hono（本地 API 服务）· three **0.128.0**。入口 `out/main/index.mjs`。

完整架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，面向用户/贡献者的说明见 [README.md](README.md)。

## 铁律（违反 = 返工）

1. **不可再生核心资产禁改**：粒子舞台 shader（`src/renderer/src/visual/stage.ts` + `shaders.ts`）、舞台 3D 歌词、玻璃 SVG 质感（`theme/classic/`）是从旧版逐字节搬迁的核心资产，各目录附 `LEGACY_COMPARISON.md`。**禁止顺手重构、格式化、"优化"**。
2. **禁止裸 RAF**：渲染层一切动画必须注册到全局 Ticker（`src/renderer/src/perf/ticker.ts`），不得直接调用 `requestAnimationFrame`——这是"最小化零视觉开销"的结构性保证。
3. **three 锁 0.128.0**：禁止升级、禁止换 import 方式；手写 ShaderMaterial 对版本敏感。`@types/three` 同锁。
4. **preload 必须 CJS**：`electron.vite.config.ts` 已固定 preload output format 为 cjs（`main.cjs`），不要改——ESM preload 会静默悬死页面加载（loadURL 永不 settle → LOAD_TIMEOUT）。
6. **凭据零明文**：cookie 一律走 safeStorage（DPAPI）加密存取（`src/main/credentials.ts`），禁止写明文文件；`plain:` 前缀旧文件只读兼容。
8. **视觉预设 ID = shader ABI**：`visual/presets/registry.ts` 的数字 ID（0 SILK/1 TUNNEL/2 ORBIT/3 VOID/4 VINYL/5 WALLPAPER，6 SKULL 保留）禁止重排。
9. **VisualBus/Scene 通道分层**：高频音频/播放态走 `visual/bus.ts`；歌词等低频快照走 `visual/scene.ts` 的独立通道，不得塞进 VisualBus ABI。

## 本机环境坑（均已实际踩过，异常先对照此表）

- **Electron 二进制下载失败**：`@electron/get` 的 Node fetch 直连不通（curl 正常）。手动填缓存：
  ```powershell
  curl -L -o $env:TEMP\electron.zip "https://registry.npmmirror.com/-/binary/electron/<版本>/electron-v<版本>-win32-x64.zip"
  curl -L -o $env:TEMP\SHASUMS256.txt "https://registry.npmmirror.com/-/binary/electron/<版本>/SHASUMS256.txt"
  node scripts/seed-electron-cache.mjs $env:TEMP\electron.zip $env:TEMP\SHASUMS256.txt
  node node_modules/electron/install.js
  ```
- **本 shell 带 `ELECTRON_RUN_AS_NODE=1`**（VSCode 扩展宿主注入）：自行 spawn Electron 前必须从 env 剔除，否则 Electron 以纯 Node 启动。`scripts/smoke.mjs` 与 E2E fixture 已内置处理。
- **pnpm 10 默认拦截 postinstall**：`package.json` 的 `pnpm.onlyBuiltDependencies` 已含 electron/esbuild/electron-winstaller/koffi/sharp；新增带原生构建的依赖记得补进去。
- **多行 `node -e` 在本 shell 静默失败**：一律写成 `.mjs` 脚本文件再执行。
- **NeteaseCloudMusicApi 必须外部化**：运行时会 fs 扫描自身目录，已在 vite external + `asarUnpack`/external 处理，不要打进 bundle。

## 工作单元的完成定义（DoD）

按顺序全部通过才算完成：

1. `pnpm typecheck` 绿（node + web 两套 tsconfig）
2. `pnpm test` 绿（vitest）
3. 标准模式冒烟通过：`pnpm build && pnpm smoke`
4. 用 `/code-review` 审一遍 diff
5. 小步 git 提交（里程碑完成时打 tag，如 `m2-done`）

## 常用命令

```bash
pnpm dev              # 新 React 壳开发（三端 HMR）
pnpm typecheck        # node + web 两套 tsconfig
pnpm test             # vitest 全量
pnpm vitest run tests/unit/<name>.test.ts   # 跑单个测试文件
pnpm test:e2e         # 先 build 再 playwright（tests/e2e/）
pnpm lint             # eslint
pnpm build            # 三端构建到 out/
pnpm smoke            # 冒烟：窗口加载 + /api/app/version 自检后自动退出
pnpm record:fixtures  # 录制 tests/fixtures/ 的上游 API fixture（接口漂移后）
pnpm build:win        # NSIS 安装包（dist/）
node scripts/gen-icons.mjs   # 改 resources/icon.svg 后重新生成 icon.png
```

## 架构速览

三进程 + 本地 API 服务；跨进程契约全部集中在 `src/shared/`（改任何跨进程接口先改这里）。

- `src/shared/` —— IPC 通道契约（`ipc-contract.ts`，单一事实源）、统一歌曲模型（`models.ts`）、性能状态机（`perf-state.ts`）、歌词解析（`lyrics/`）、updater/wallpaper/custom-background 契约。
- `src/main/` —— Electron 主进程：窗口（`windows/`）、IPC（`ipc.ts`）、性能治理（`perf-governor.ts`）、safeStorage 凭据（`credentials.ts`）、updater 适配层（`updater/`，adapter 模式）、自定义背景/Wallpaper Engine（`background/`）、E2E 网络守卫。
- `src/preload/` —— `main.ts`（`window.fluxDesktop` 桥）。
- `src/server/` —— 本地 API（Hono，`127.0.0.1:43110`）：`providers/{netease,qq}`（上游适配 + 纯函数 mapper）、`routes/`、媒体代理 `proxy.ts`（CDN 域白名单）、`static.ts`。
- `src/renderer/` —— React 单页应用：`stores/`（zustand：player 三层兜底/auth）、`playback/`（quality/match/blacklist 纯逻辑）、`features/`（library/lyrics/playlist/system）、`perf/ticker.ts`（全局 Ticker）、`theme/`、`visual/`（three 视觉引擎：stage/audio/lyrics3d/presets）、`components/glass/`。

关键常量：本地端口 43110 · 试听 30s · 失败黑名单 18s · QQ 登录后轮询 45s · 登录 cookie 轮询 1.2s · 歌词合并容差 0.35s · FFT 2048 · 粒子网格 118² · `flux-background://` 协议 · Wallpaper Engine Workshop appid 431960。

## 与旧版的行为差异

- 手写更新/补丁系统已移除：`/api/update/*` 返回 `UPDATE_SYSTEM_REMOVED`；改用 electron-updater（`flux-updater-*` IPC，GitHub `hey-sm/FluxPlayer`）。
- 动态壁纸经 koffi + 新视觉引擎重做中（`wallpaper-contract.ts`，`WALLPAPER_PUSH_INTERVAL_MS=100`）。
- `/api/audio`、`/api/cover` 代理增加音源 CDN 域白名单。
- 登录窗口不再自动点击页面登录按钮（降低对页面结构的依赖）；改为轮询 partition cookie。

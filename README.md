# FluxPlayer（工程化重构版）

Mineradio 的 fork 重构工程。规划见仓库根目录 [../REFACTOR_PLAN.md](../REFACTOR_PLAN.md)，旧代码位于上层目录且**保持只读**。

## 技术栈

electron-vite · Electron · React 19 · TypeScript · zustand · TanStack Query · Hono（本地 API 服务）

## 目录

```
src/
├─ shared/     跨进程契约：IPC 通道、统一歌曲模型、性能状态机类型
├─ main/       Electron 主进程（窗口/登录窗口/IPC/性能状态机/safeStorage 凭据）
├─ preload/    main.ts（新版 fluxDesktop 桥）+ legacy.ts（旧 desktopWindow 兼容桥）
├─ server/     本地 API（Hono）：providers/netease、providers/qq、routes、媒体代理、静态服务
└─ renderer/   React 应用（当前为 M2 迁移验证壳：搜索 → 取链 → 代理播放）
```

## 常用命令

```powershell
pnpm install          # 安装依赖（.npmrc 已配置 npmmirror 与 electron 镜像）
pnpm dev              # 开发模式（React 壳 + 本地 API 热重载）
pnpm sync-legacy      # 把旧 ../public 复制到 legacy/（只读复制，不动旧目录）
pnpm dev:legacy       # strangler 验证：旧 index.html 原样跑在新 server 上
pnpm typecheck        # 双 tsconfig 类型检查
pnpm build            # electron-vite 构建 out/
pnpm smoke            # 构建后烟雾测试（自动启动并退出）
pnpm build:win        # NSIS 安装包（dist/）
```

## 与旧版的行为差异（M2 阶段）

- 手写更新/补丁系统已移除：`/api/update/*` 返回 `UPDATE_SYSTEM_REMOVED`（M6 换 electron-updater）
- 动态壁纸模式将在 M5 以 koffi + 新视觉引擎重做（当前 IPC 返回 `WALLPAPER_NOT_AVAILABLE_YET`）；桌面 3D 歌词进 backlog
- 天气电台、播客域、服务端 DJ 节拍分析尚未迁移：对应端点返回可降级的空/错误形状
- `/api/audio`、`/api/cover` 代理增加了音源 CDN 域白名单
- Cookie 改为 safeStorage 加密存储（不再有明文 .cookie / .qq-cookie）
- 登录窗口不再自动点击页面登录按钮（降低对页面结构的依赖）
- 透明窗口在弱 GPU/远程会话下加载失败会自动降级为不透明深色窗口（`FLUX_OPAQUE=1` 可强制）

## 图标

`resources/icon.svg` 为图标源（用户提供的 glyph 合成深色圆角底版本）。改动后运行 `node scripts/gen-icons.mjs` 重新生成 `resources/icon.png`（窗口图标 + electron-builder 自动转 ico）；renderer favicon 位于 `src/renderer/public/favicon.svg`。

## 本机网络备注

`@electron/get` 的 Node fetch 在本机直连失败（curl 正常）。如果重装依赖后 Electron 二进制缺失：

```powershell
curl -L -o $env:TEMP\electron.zip "https://registry.npmmirror.com/-/binary/electron/<版本>/electron-v<版本>-win32-x64.zip"
curl -L -o $env:TEMP\SHASUMS256.txt "https://registry.npmmirror.com/-/binary/electron/<版本>/SHASUMS256.txt"
node scripts/seed-electron-cache.mjs $env:TEMP\electron.zip $env:TEMP\SHASUMS256.txt
node node_modules/electron/install.js
```

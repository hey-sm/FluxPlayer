# FluxPlayer Electron 架构分析报告

> 依据 `electron-development` skill（安全 IPC / contextIsolation / 多进程架构 / 打包与更新的生产级检查单）对 `src/main`、`src/preload`、`src/server`、`src/shared` 及构建配置进行的全面审计。
> 分析日期：2026-07-17 · 代码基线：`main @ 5f1c78f` · 约 13,000 行 TypeScript。
> 使用场景校准：本项目为个人自用软件，安全项的"修复优先级"按此场景标注；"严重度"仍按技术事实标注。

---

## 1. 架构总览

FluxPlayer 是一个五层结构的 Electron 桌面音乐播放器：

```
┌─────────────────────────────────────────────────────────────┐
│ Main Process (src/main)                                     │
│  ├─ index.ts            生命周期 / 单实例锁 / 启动编排        │
│  ├─ ipc.ts              全部 ipcMain.handle 注册（依赖注入）  │
│  ├─ windows/            主窗口 + 网易云/QQ 登录窗口           │
│  ├─ credentials.ts      DPAPI 加密凭据存储（日志式原子写）    │
│  ├─ background/         自定义背景 + Wallpaper Engine 导入    │
│  ├─ perf-governor.ts    窗口状态 → 性能模式状态机             │
│  └─ updater/            M6 显式更新状态机（adapter 可替换）   │
│                                                             │
│  内嵌 HTTP Server (src/server, Hono @ 127.0.0.1)            │
│  ├─ 静态托管 renderer 产物（生产模式的页面来源）              │
│  ├─ providers/netease + providers/qq（上游 API 适配）        │
│  └─ proxy.ts            封面/音频代理（上游主机白名单）       │
├─────────────────────────────────────────────────────────────┤
│ Preload (src/preload/main.ts, CJS)                          │
│  └─ contextBridge 暴露 window.fluxDesktop（窄接口、类型化）  │
├─────────────────────────────────────────────────────────────┤
│ Renderer (src/renderer, React 19 + zustand + react-query)   │
│  └─ 经 http://127.0.0.1:<port> 加载；API 走同源相对路径      │
├─────────────────────────────────────────────────────────────┤
│ Shared (src/shared)                                         │
│  └─ 纯类型/常量契约：ipc-contract / updater-contract / 歌词  │
└─────────────────────────────────────────────────────────────┘
```

关键架构决策：**renderer 不走 `file://`，而是由主进程内嵌的 Hono 服务器托管**（[index.ts:184-198](src/main/index.ts#L184-L198)）。生产环境固定端口 43110 以保证 Web Storage/IndexedDB 的 origin 跨启动稳定；开发/smoke/E2E 用空闲端口隔离并行。这个决策换来了稳定 origin 和"renderer 与音乐 API 同源"的简单性，但也是 §3.1 问题的根源。

### 进程与构建边界

- 三个独立入口（main ESM / preload CJS / renderer），由 electron-vite 分别构建（[electron.vite.config.ts](electron.vite.config.ts)）。preload 显式用 CJS 并注释了原因（ESM preload 出错会静默悬死）——正确的工程判断。
- `src/shared` 只含类型、常量与纯函数（歌词解析），无跨进程可执行副作用——符合 skill 的 "shared types, not shared modules" 原则。
- `NeteaseCloudMusicApi`、`koffi`、`electron-updater` 显式 external 且注释了原因（NCM 运行时用 fs 扫描自身模块目录）——正确。

---

## 2. 对照生产安全检查单的达标项

以下是明确做对、且多数超出 skill 基线的地方（后续重构时**不要**破坏这些设计）：

| 检查项 | 状态 | 证据 |
|---|---|---|
| `contextIsolation: true` | ✅ | [main-window.ts:234](src/main/windows/main-window.ts#L234) |
| `nodeIntegration: false` | ✅ | [main-window.ts:235](src/main/windows/main-window.ts#L235) |
| preload 用 contextBridge、不暴露裸 ipcRenderer | ✅ | [preload/main.ts:58](src/preload/main.ts#L58)。暴露固定方法名的窄接口，比 skill 示例的"通道白名单 + 通用 send/invoke"更严格 |
| IPC 通道名单一事实源 | ✅ | [shared/ipc-contract.ts](src/shared/ipc-contract.ts) |
| 请求/响应式 IPC 全用 `invoke/handle`，无 `sendSync` | ✅ | [ipc.ts](src/main/ipc.ts) 全文 |
| 敏感 IPC 校验发送者 | ✅✅ | `isPrimaryRenderer` 同时校验 sender 窗口、mainFrame 与 frame origin（[ipc.ts:85-102](src/main/ipc.ts#L85-L102)），更新器与自定义背景全部套用——超出 skill 基线 |
| CSP | ✅ | [index.html:5-9](src/renderer/index.html#L5-L9) meta CSP：`script-src 'self'`、无 `unsafe-eval`，img/media/connect 按需收敛 |
| 阻止任意导航 | ✅ | `will-navigate` 只放行同 origin（[main-window.ts:257-270](src/main/windows/main-window.ts#L257-L270)） |
| 新窗口一律 deny | ✅ | `setWindowOpenHandler` 返回 `deny`（[main-window.ts:248-256](src/main/windows/main-window.ts#L248-L256)） |
| 凭据不落明文 | ✅✅ | `SafeCredentialStore`：DPAPI 加密 + 写前/写后回读校验 + 替换日志（journal）+ 启动时崩溃恢复（[credentials.ts](src/main/credentials.ts)）——远超一般 Electron 项目水准 |
| 登录窗口隔离 | ✅ | 独立 `persist:` partition + `sandbox: true`（[login-windows.ts:170-175](src/main/windows/login-windows.ts#L170-L175)），cookie 采集有域名白名单 |
| 自定义协议路径安全 | ✅ | `flux-background:` 协议经 `resolveRequestUrl` 白名单解析，`isInside` 防目录穿越（[custom-background.ts:234-250](src/main/background/custom-background.ts#L234-L250)） |
| 媒体代理防 SSRF | ✅ | `/api/cover`、`/api/audio` 有上游主机后缀白名单（[proxy.ts:9-33](src/server/proxy.ts#L9-L33)），注释明确说明是对旧版开放代理的收敛 |
| 静态服务防目录穿越 | ✅ | [static.ts](src/server/static.ts) `path.resolve` + 前缀校验 |
| 单实例锁 | ✅ | [index.ts:259](src/main/index.ts#L259)，测试运行时豁免且注释了原因 |
| asar | ✅ | [electron-builder.yml](electron-builder.yml)，koffi 原生模块正确 asarUnpack |
| 用户数据位置 | ✅ | 凭据/背景均在 `app.getPath('userData')` 下 |
| 更新流程 | ✅ | M6 状态机：无自动检查/下载，每步都是显式 renderer 命令且校验主 renderer 身份；dev/smoke 下连 electron-updater 都不加载（[index.ts:122-138](src/main/index.ts#L122-L138)）；安装前 strict 清理失败会阻止 quitAndInstall |

其他值得点名的工程质量：

- `loadURL` 超时竞速防渲染进程崩溃悬死（[main-window.ts:205-211](src/main/windows/main-window.ts#L205-L211)）；
- 烟雾测试全局看门狗在一切 `await` 之前装载（[index.ts:273-280](src/main/index.ts#L273-L280)）；
- E2E 网络守卫在模块加载最早期 patch `http/https/fetch`，非回环请求直接抛错（[e2e-network-guard.ts](src/main/e2e-network-guard.ts)）；
- 退出 / 重启 / 更新安装共用一条显式清理链，更新安装用 strict 模式（[index.ts:46-98](src/main/index.ts#L46-L98)）；
- `PerfGovernor` 把 BrowserWindow 依赖抽象成接口，可用轻量 fake 做单测（[perf-governor.ts:9-22](src/main/perf-governor.ts#L9-L22)），`tests/unit` 有对应覆盖。

**总体评价：主进程与 IPC 层的安全设计与工程纪律显著高于社区平均水平。** 问题集中在"内嵌 HTTP 服务器"这一个信任边界上。

---

## 3. 发现的问题（按严重度排序）

### 3.1 【严重度：高 · 自用优先级：中高】本地 API 无鉴权 + `Access-Control-Allow-Origin: *` + 生产固定端口

**位置**：[server/index.ts:29-37](src/server/index.ts#L29-L37)、[index.ts:19,186-189](src/main/index.ts#L186-L189)

三个决策叠加放大：

1. 生产端口**固定为 43110**（可预测）；
2. `/api/*` 全部返回 `Access-Control-Allow-Origin: *` 并短路应答 OPTIONS 预检——这不仅允许任意网页**发**请求，还允许它**读取响应**；
3. 所有 API 端点**无鉴权**——网易云/QQ 凭据由服务端（`SafeCredentialStore`）自动附加。

**攻击面**：只要 FluxPlayer 在运行，用户在任何浏览器中打开的任意网页都可以静默地：

- `GET /api/login/status`、`/api/qq/login/status` —— 读取昵称、头像、VIP 状态、userId（隐私指纹）；
- `GET /api/user/playlists`、`/api/user/liked/tracks` —— 用你的登录态拉取全部歌单
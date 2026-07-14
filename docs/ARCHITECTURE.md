# FluxPlayer 架构

FluxPlayer 是独立的 Electron + React 桌面音乐播放器。

## 进程结构

```text
Electron main (src/main)
  ├─ 本地 Hono API (src/server, 127.0.0.1:43110)
  ├─ 窗口、凭据、更新器、全局快捷键
  └─ 自定义背景 / Wallpaper Engine
          │ IPC: src/shared
preload/main.ts → window.fluxDesktop
          │
React renderer (src/renderer)
  ├─ 左侧歌单 / 右侧歌曲详情
  ├─ 播放状态与音源匹配
  └─ three.js 粒子舞台 + 3D 歌词
```

## 主进程

- `src/main/index.ts`：应用生命周期、本地服务、更新器与窗口装配。
- `src/main/windows/main-window.ts`：恒定不透明的无框主窗口；`loadURL` 有 15 秒安全超时。
- `src/main/credentials.ts`：使用 Electron `safeStorage` 保存网易云和 QQ cookie。
- `src/main/updater/`：显式检查、下载和安装的 electron-updater 状态机。
- `src/main/background/`：受控自定义背景与 Wallpaper Engine 项目导入。
- `src/main/ipc.ts`：窗口、登录、更新器、背景和全局快捷键 IPC。

正式版固定使用端口 43110，保证 Web Storage origin 稳定；开发、smoke 和 E2E 使用从 43110 起的空闲端口。

## Preload 与共享契约

`src/preload/main.ts` 以 CJS 输出为 `main.cjs`，只暴露 `window.fluxDesktop`。跨进程通道和数据契约集中在 `src/shared/`。preload 不可改为 ESM。

## 本地 API

`src/server/index.ts` 装配顺序：API 中间件 → misc → netease → qq → media proxy → static。

保留的功能面：

- `/api/app/version`
- 网易云和 QQ 的登录状态、cookie 登录、退出、搜索、歌曲 URL、歌词、用户歌单、收藏歌曲和歌单曲目
- `/api/audio`、`/api/cover` 受控媒体代理

Provider 位于 `src/server/providers/{netease,qq}`，负责上游 SDK/HTTP 调用和统一歌曲模型映射。

## Renderer

- `stores/`：播放器与认证状态。
- `features/playlist`、`features/library`：歌单、收藏与最近播放。
- `features/lyrics`：歌词查询和状态；舞台显示由 `visual/lyrics3d` 完成。
- `visual/stage.ts`：three.js 粒子舞台。
- `visual/audio/`：实时 WebAudio FFT。
- `visual/bus.ts`：高频播放和音频快照。
- `visual/scene.ts`：低频 3D 歌词快照。
- `visual/presets/`：固定数字 ABI 的六种视觉预设。
- `perf/ticker.ts`：所有 renderer 动画的统一时钟。

视觉预设 ID 不得重排：0 SILK、1 TUNNEL、2 ORBIT、3 VOID、4 VINYL、5 WALLPAPER；6 SKULL 为 shader 保留值。three 与 `@types/three` 固定为 0.128.0。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
```

单元测试使用 Vitest；E2E 使用 Playwright。fixture 只保留仍在使用的网易云和 QQ 接口响应。

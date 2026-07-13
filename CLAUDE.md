# FluxPlayer Next —— Claude 工作守则

FluxPlayer 的工程化重构工程（fork 自 Mineradio v1.1.1，React 重写）。
**权威规划：仓库根目录的 `REFACTOR_PLAN.md`**（产品决策、里程碑、验收标准、执行日志）。任何工作单元开始前先读它的"执行日志"接上进度；完成后必须更新日志。

## 铁律（违反 = 返工）

1. **旧代码只读**：仓库根目录的旧 Mineradio 代码一律不改，仅作参考；所有改动只发生在 `fluxplayer-next/` 内。
2. **搬迁 ≠ 重写**：粒子舞台 shader、舞台歌词、3D 歌单架、玻璃 SVG 质感（`docs/GLASS_SVG_TEXTURE.md`）是不可再生核心资产，逐字节搬迁，**禁止顺手重构、格式化、"优化"**。
3. **禁止裸 RAF**：渲染层一切动画必须注册到全局 Ticker（`src/renderer/src/perf/ticker.ts`），不得直接调用 `requestAnimationFrame`——这是"最小化零视觉开销"的结构性保证。
4. **three 锁 0.128.0**：禁止升级、禁止换 import 方式；手写 ShaderMaterial 对版本敏感。升级 three 是重构完成后的独立任务。
5. **preload 必须 CJS**：`electron.vite.config.ts` 已固定 preload output format 为 cjs，不要改——ESM preload 会静默悬死页面加载（loadURL 永不 settle → LOAD_TIMEOUT）。
6. **API 兼容**：M3 完成前 `/api/*` 路径与旧版完全兼容，legacy 模式（旧 index.html 跑在新 server 上）必须始终可用。
7. **凭据零明文**：cookie 一律走 safeStorage 加密存取，禁止写明文文件。
8. **窗口生命周期**：透明窗口失败自动降级不透明的重建逻辑不要动；销毁旧窗口前必须先创建新窗口，否则 window-all-closed 会误退出。

## 本机环境坑（均已实际踩过，异常先对照此表）

- **Electron 二进制下载失败**：@electron/get 的 Node fetch 直连不通（curl 正常）。用 `scripts/seed-electron-cache.mjs` + curl 手动填缓存，完整命令见 `README.md`。
- **本 shell 带 `ELECTRON_RUN_AS_NODE=1`**（VSCode 扩展宿主注入）：自行 spawn Electron 前必须从 env 剔除，否则 Electron 以纯 Node 启动。`scripts/smoke.mjs` 已内置处理。
- **pnpm 10 默认拦截 postinstall**：package.json 的 `pnpm.onlyBuiltDependencies` 已含 electron/esbuild/sharp 等；新增带原生构建的依赖记得补进去。
- **多行 `node -e` 在本 shell 静默失败**：一律写成 `.mjs` 脚本文件再执行。
- **透明+无框窗口首载可能崩渲染进程**：主窗口已实现自动降级重建；`FLUX_OPAQUE=1` 可强制不透明启动。

## 工作单元的完成定义（DoD）

按顺序全部通过才算完成：

1. `pnpm typecheck` 绿
2. `pnpm test` 绿（vitest）
3. 双模式冒烟通过：`pnpm build && pnpm smoke && node scripts/smoke.mjs --legacy`
4. 用 `/code-review` 审一遍 diff
5. 小步 git 提交（里程碑完成时打 tag，如 `m2-done`）
6. 更新根目录 `REFACTOR_PLAN.md` 执行日志

## 常用命令

```bash
pnpm dev              # 新 React 壳开发（三端 HMR）
pnpm dev:legacy       # legacy 模式：旧 index.html 跑在新 server 上
pnpm typecheck        # node + web 两套 tsconfig
pnpm test             # vitest
pnpm build            # 三端构建到 out/
pnpm smoke            # 冒烟：窗口加载 + /api/app/version 自检后自动退出
node scripts/smoke.mjs --legacy   # legacy 模式冒烟
pnpm sync-legacy      # 从旧目录同步 legacy/ 静态资源（legacy/ 不入库）
pnpm build:win        # NSIS 安装包
```

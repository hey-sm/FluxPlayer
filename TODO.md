# TODO

发版前与后续的待办。P0 项已在 2026-08-20 的代码审查中修完，此处只留**需要人工验证**或**待决策**的部分。

---

## 🔴 发版前必须人工验证

### 1. 两个平台的真实登录流程

**为什么需要人工**：登录窗口是全项目唯一加载远程第三方页面的地方，无法自动化验证真实登录。审查中收紧了它的导航策略（[src/main/windows/login-windows.ts](src/main/windows/login-windows.ts)），改动可能影响真实鉴权跳转。

**改了什么**：

- 非 http(s) scheme 一律拒绝，不再转交 `shell.openExternal`（原先 QQ 窗口会把 `file:` / `ms-msdt:` / `search-ms:` 等任意 URI 交给操作系统 handler）
- 网易域名白名单正则末尾加了锚定（原先 `https://163.com.attacker.example/` 会被误判为站内）
- 两个窗口补了 `will-navigate` / `will-redirect` 白名单（原先只拦 `window.open`，页面内 `location.href=` 可以漂到任意站点）

**怎么验**：`pnpm dev`，然后逐条走：

- [ ] **网易云 · 扫码登录** → 能出二维码、扫码后窗口自动关闭、回到主界面显示已登录
- [ ] **网易云 · 手机号/密码登录** → 含验证码环节（易盾验证码走 `dun.163.com`，应在白名单内）
- [ ] **QQ 音乐 · QQ 登录** → 走 `ptlogin2.qq.com`，登录后能拿到 `qm_keyst`（不只是网页登录态）
- [ ] **QQ 音乐 · 微信扫码登录** → 走 `open.weixin.qq.com`，注意它在 `.qq.com` 下应被放行
- [ ] 登录后能**实际播放**一首 VIP 歌曲（验证拿到的是播放授权而非仅网页登录态）

**万一断了怎么办**：被拦截的目标都会打日志，格式为

```
Netease login navigation blocked: <url>
QQ login redirect blocked: <url>
```

在 `pnpm dev` 的终端里搜 `blocked`，就能定位是哪个第三方鉴权域被误拦。补白名单的位置在 `isQQCookieDomain` / `isNeteaseCookieDomain`（[login-windows.ts](src/main/windows/login-windows.ts)）——这两个函数同时被 cookie 采集和导航策略复用，改一处即可。

### 2. 打包后的安装版实跑

**为什么需要人工**：有一类构建陷阱**只在安装版暴露**，`pnpm dev` 永远复现不出来（详见 [electron.vite.config.ts](electron.vite.config.ts) 顶部注释的不变量）。

- [ ] `pnpm build:win` → 实际安装 → 启动 → 登录 → 播放一首完整歌曲
- [ ] 确认动态背景、3D 歌词正常（这两处是懒加载 chunk，已加错误兜底，但兜底不该被触发）

### 3. 发布流水线端到端演练

- [ ] `.github/workflows/release.yml` 的 tag 发布路径（`gh release create/upload`）**从未跑过一次**。建议先用一个测试 tag 跑通再发正式版。

---

## 🟡 待决策

### C2 · keyring 不可用时的凭据策略

**现状**：`safeStorage` 不可用时（Linux 无 libsecret/kwallet、macOS 钥匙串被拒），[src/main/credentials.ts](src/main/credentials.ts) 的 `set()` 只 `console.warn`，不更新缓存、不向上抛错 → **登录流程返回成功，实际什么都没存**，renderer 无从得知。用户表现为「登录了但重启后又要登录」，且没有任何提示。

安全性上这是理想的 fail-closed（绝不降级明文），问题只在于**静默**。

**三选一**（需要你定）：

1. **硬失败** —— 明确告诉用户「本机无法安全存储凭据」，登录直接失败
2. **会话内存态** —— 本次运行内可用，重启需重登，并明确提示
3. **保持静默** —— 维持现状（不推荐：用户会以为是 bug）

选 2 需要同时改 `set()` 让它在写盘失败时仍更新 `cache`，并新增一个错误码经 IPC 回传。

---

## 🟢 Backlog（不阻塞发版）

来自审查的 P2/P3，按价值排序：

- [ ] **A4 收尾** —— `externalizeDepsPlugin` 与「全部内联」的打包模型本质上是冲突的（插件是为「随包分发 node_modules」的应用设计的）。当前靠 `exclude` 列表 + `dependencies` 保持近乎空来维持正确，已在配置里写明不变量。彻底的做法是去掉插件、只保留 `external: ['electron']`，但那是构建行为变更，建议发版后再做。
- [ ] **补组件测试** —— jsdom + @testing-library/react 的能力已就绪（见 [tests/unit/error-boundary.test.tsx](tests/unit/error-boundary.test.tsx) 的写法，文件顶部加 `// @vitest-environment jsdom`）。36 个 `.tsx` 目前仍零覆盖，但 alpha 期 UI 还会大改，建议只在改动某个组件时顺手补，不要批量写。
- [ ] **测试质量清理** —— 部分单测在断言 Tailwind class 字面量（如 `renderer-ui-variants.test.ts` 的 `toContain('min-h-[30px]')`），是伪装成单测的样式快照：改版必红，但不证明任何行为。
- [ ] **`setKeepAliveOverride` 死代码** —— `src/main/perf-governor.ts` 的 setter 零生产调用点，唯一调用者是它自己的单测（ticker 侧的读取是活的，不要一起删）。
- [ ] **自建 RAF 收敛** —— `components/glass/store.ts` 与 `features/settings/WallpaperEngineLayer.tsx` 两处自建 RAF 节流绕过了 `PerfState` 降频。
- [ ] **前台空闲 RAF 空转** —— `PlayerBar.tsx` 无条件把 `syncProgress` 注册进 ticker，导致「窗口可见但没在播放」时仍跑满帧。注册应门控在 `status === 'playing'`。
- [ ] **localStorage 收敛** —— 13 个 key、三套前缀（`fluxplayer-` / `flux-` / `fluxplayer.`），只有 2 个有版本迁移。
- [ ] **`noUncheckedIndexedAccess`** —— provider 层大量处理上游 JSON 数组下标，开启后能挡住一类越界。
- [ ] **oxlint 只开了 `correctness`** —— `suspicious` / `perf` 等 category 未启用；`scripts/**` 完全不 lint。
- [ ] **工作树清理** —— `Mineradio/` 与 `cineshader-mirror/` 两棵外部参考树（已 gitignore 但物理存在，会污染全仓 grep 与 IDE 索引）；`scripts/spike-three-text.mjs.depth` 残留产物。

---

## 🚫 明确不做

单人仓库，以下是纯仪式，只增摩擦不产生信息：PR 触发 CI、SECURITY.md、CODEOWNERS、dependabot、PR/issue 模板。

`App.tsx`（637 行 / 20 useState / 13 useEffect）的可读性拆分同样不做：它能跑，收益方只有作者一人，而在组件测试接近零的区域做大手术，风险方是全部用户。等组件测试补上来再说。

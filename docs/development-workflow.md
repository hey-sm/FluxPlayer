# FluxPlayer 开发工作流

> 本文件面向人和 AI 编码 agent。读完这份文档你应该���道：改完代码跑什么、什么时候改文档、怎么提交、怎么用多 agent 协作而不互相打架。

## 提交前的验证序列

**按改动的影响面跑，不跑不会受影响的那部分**。顺序：区域测试 → 受影响的 typecheck → lint →（按需）全量 test。

```
① 区域测试  →  ② typecheck（只跑受影响的那套）  →  ③ lint + format  →  ④ 全量 test（仅跨区域改动时）
```

核心判断：改动的文件属于哪个 tsconfig 子树，就只跑那套 typecheck；改动的区域有对应测试，就只跑那些测试。**不要每次都无脑跑全量 typecheck + 全量 test**——那是在跑不会受影响的代码。

### ① 区域测试（先跑，快速定位）

改动落到哪一类文件，就先跑对应的边界/单元测试。完整对照表见 [CLAUDE.md → 改动后的验证序列](../CLAUDE.md)。这里列出最高频的几条：

| 改了什么                                       | 先跑                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/ipc.ts` 或 `protocols/`              | `pnpm vitest run tests/unit/electron-ipc-security.test.ts tests/unit/server-boundary.test.ts tests/unit/electron-media-protocol.test.ts` |
| `src/server/providers/netease/sdk.ts`          | `pnpm vitest run tests/unit/netease-sdk-allowlist.test.ts`                                                                               |
| provider 映射（`mappers`）                     | 对应 `*-mappers.test.ts` + `*-fixture.test.ts`，改了映射要核对 `tests/unit/__snapshots__/` 是否需更新                                    |
| `src/renderer/src/playback/engine.ts`          | `pnpm vitest run tests/unit/player-failure.test.ts tests/unit/player-modes.test.ts tests/unit/player-progress-isolation.test.ts`         |
| `src/renderer/src/visual/` 或 `perf/ticker.ts` | `pnpm vitest run tests/unit/visual-scene.test.ts tests/unit/perf-ticker.test.ts`                                                         |

### ② typecheck（只跑受影响的那套）

三套 tsconfig 各管不同的 src 子树，只跑改动触及的那套（或两套）：

| 改了什么                                  | 跑哪套                               |
| ----------------------------------------- | ------------------------------------ |
| `src/main` / `src/preload` / `src/server` | `tsc --noEmit -p tsconfig.node.json` |
| `src/renderer/**`                         | `tsc --noEmit -p tsconfig.web.json`  |
| `tests/**`                                | `tsc --noEmit -p tsconfig.test.json` |
| `src/shared`（双方都 import）             | 跑 `node` + `web` 两套               |

```bash
# 单套（大多数情况）
pnpm exec tsc --noEmit -p tsconfig.web.json

# 改了 shared 或想一次跑完
pnpm typecheck   # 串行跑三套
```

### ③ lint + format（全量，快）

oxlint + oxfmt 跑全仓库约 0.1s，无脑全量即可：

```bash
pnpm lint
pnpm format            # 校验格式，不过时跑 pnpm format:write
```

### ④ 全量单测（仅跨区域改动时）

**只在改动跨越多个区域、或改动 `src/shared` 这种被多处依赖的代码时**才跑 `pnpm test`。单区域改动跑完 ① 的区域测试就够了。

```bash
pnpm test   # 仅当改动跨越多个区域时
```

### ⑤ e2e（仅改了渲染层交互时）

```bash
pnpm test:e2e   # 先 build 再跑 playwright，约 50s，CI 不跑
```

e2e 起真实 Electron 做像素与动画断言，CI runner 没有 GPU 所以不在 CI 跑——这步只能本地做。改了纯逻辑（server / shared / 类型）不需要跑。

## 提交规范

### Commit message

沿用现有约定，用前缀分类（见 `git log --oneline`）：

| 前缀        | 用于                                                     |
| ----------- | -------------------------------------------------------- |
| `feat:`     | 新功能                                                   |
| `fix:`      | 修 bug                                                   |
| `docs:`     | 文档（CLAUDE.md / README / docs/ / THIRD_PARTY_NOTICES） |
| `chore:`    | 杂务（格式、依赖、非功能改动）                           |
| `ci:`       | CI / 构建流水线                                          |
| `refactor:` | 不改行为的重构                                           |
| `test:`     | 新增或改测试                                             |

格式：`<前缀>: <简述>`。简述用祈使句，中文，一行内。例：`feat: word-level lyrics, VIP badges, chksz backend`。

### 提交前自查清单

提交前确认：

- [ ] ① 的区域边界测试已跑且全绿
- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm lint` 无报错，`pnpm format` 通过
- [ ] `pnpm test` 全绿；若快照变更是有意的，已用 `-u` 更新并确认 diff
- [ ] 改了渲染层交互的，本地跑过 `pnpm test:e2e`
- [ ] 改了 IPC / 协议 / SDK 门面的，看过 `server-boundary.test.ts` 和 `electron-ipc-security.test.ts`
- [ ] 触及安全不变量（见 CLAUDE.md）的改动，确认 5 条不变量都没破

### 发版

发版流程单独见 [releasing.md](releasing.md)。要点：推 `main` 不跑 CI；打 `v*` 标签才跑完整流水线并建 Release；标签名必须等于 `package.json` 的 `v` + version。

## 文档持续更新

文档不是一次写完的，是随代码演进持续维护的。**谁改了代码，谁负责把文档带到一致**。以下情况必��在同一次改动里更新文档：

### 必须同步更新的对照

| 改了什么                                            | 更新什么                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 新增 / 删除 / 改名 IPC 通道                         | [CLAUDE.md](../CLAUDE.md) 的安全不变量 + [src/shared/ipc-contract.ts](../src/shared/ipc-contract.ts) 常量 + `server-boundary.test.ts` 的通道列表 |
| 新增 provider                                       | CLAUDE.md 的 Provider 编排段落 + `MusicService.select()` + `ProviderId` 联合类型                                                                 |
| 新增 chksz 级别的后端切换逻辑                       | CLAUDE.md 的 chksz 段落 + `music-contract.ts` 的 `backend` 字段                                                                                  |
| 改了安全不变量（上游 URL / 凭据 / 协议 / SDK 门面） | CLAUDE.md 的 5 条不变量 + 对应边界测试的断言                                                                                                     |
| 新增 / 收敛"已知债"                                 | CLAUDE.md 视觉系统段落标注的待收敛项                                                                                                             |
| 新增测试文件且它守护某个边界                        | CLAUDE.md 的"改动后的验证序列"表加上对应行                                                                                                       |
| 大文件结构变化（段落地图注释里的行号区间）          | 文件头的段落地图注释                                                                                                                             |
| 改了发布 / 签名 / 平台目标                          | [releasing.md](releasing.md)                                                                                                                     |
| 新增 / 改第三方素材许可                             | [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)                                                                                              |
| 改了玻璃系统配置范围或 CSS 变量                     | [liquid-glass-system.md](liquid-glass-system.md)                                                                                                 |

### 判断"该不该写文档"的简单规则

- **写进 CLAUDE.md**：架构不变量、跨进程契约、"引擎不做"这类反向约束、已知债。
- **写进 docs/**：单一系统的详细设计（玻璃系统、歌词字体、迁移计划、发布流程、本工作流）。
- **写进代码注释**：段落地图（大文件）、安全不变量的就地提醒（如 `music-contract.ts` 里的 `upstream URLs never cross IPC`）。
- **不写**：能从代码直接读出的、一次性的、会被很快改掉的。

CLAUDE.md 是 AI agent 的主上下文，保持它在"正确高度"——不是 if-else 清单，也不是空话，而是点明不变量和反例。

## AI 编码协作约定

### 多 agent 的使用边界

并行 agent 只在**并行探索有回报**且**隔离已解决**时用。具体：

| 场景                                                | 用法                                                       | 依据                       |
| --------------------------------------------------- | ---------------------------------------------------------- | -------------------------- |
| 安全不变量审计、provider 重复度分析、跨文件只读研究 | 并行只读 subagent，各自独占文件，只回传精炼结构化摘要      | 并行探索有回报，只读无冲突 |
| 改 IPC / 协议 / 凭据等安全敏感代码                  | **不用**并行，单 agent 顺序改 + 人逐行审                   | 不可逆决策，并行扩大风险面 |
| 改同一文件的多处（如收敛两处 RAF 债）               | **不用**并行，顺序化（共享 `ticker` 模块）                 | 同文件编辑会打架           |
| 重命名 / 改一个测试 / 读一个文件                    | **不开** subagent，直接做                                  | 开销大于任务               |
| 大型重构（拆 App.tsx 等）                           | 先写拆分规约，再按文件所有权切分并行，用 git worktree 隔离 | 并行前提是隔离已解决       |

### subagent 的返回契约

派 subagent 时必须定义明确的返回结构，而不是"去看看这个"。好例：

> 审 `src/main/ipc.ts` 里所有 `ipcMain.handle` 是否都经 `secureHandle`。只返回 `{通道名, 是否经secureHandle, 证据行号}` 列表，不返回代码片段。

返回要"易接受、易拒绝、易转成任务"。subagent 不是决策 owner——主 agent / 人是。

### 上下文管理

- CLAUDE.md 是预载的主上下文，大文件用文件头的段落地图注释做 just-in-time 检索锚点。
- subagent 只回传精炼摘要（约 1-2k token），不把原始代码 / 日志倒回主上下文。
- 改代码前先读对应的边界测试，理解"不变量"再动手——测试是最可靠的规约。

### 遇歧义升级，而非猜测

agent 遇到规约未覆盖的情况时，应**停下来报告**而不是用"局部合理"的假设填补。尤其是：

- 顺序约束（schema 变更、部署排序、共享状态边界）
- 安全不变量的边界情况
- provider 行为的 provider 特有逻辑

报告格式：`{遇到什么, 规约没覆盖什么, 我的两个候选做法, 建议哪个}`。人来定。

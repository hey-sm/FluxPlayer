
FluxPlayer 精简为独立项目 —— 执行计划
Context（为什么做这个改动）
FluxPlayer 已完成从旧 Mineradio 项目的 strangler 迁移，现在要作为一个完全独立的全新项目存在，不再保留任何与旧项目的关联和兼容包袱。owner 确认当前实际需要的功能面只有：

QQ + 网易云登录与数据获取
UI：左右两侧歌单/歌曲栏 + 中间 3D 粒子舞台（含中间 3D 歌词）
保留：自定义背景 + Wallpaper Engine、更新器 + 全局快捷键
其余为迁移期遗留或从未接入的死代码。本次做全量清理：删除 legacy 模式、透明窗口降级、3D 歌单架、天气、DIY 面板，以及一批确认无人调用的服务端路由和 renderer 死代码，让代码库只剩真正在用的功能。

owner 决策记录：

删除范围 = 全量清理
保留：中间 3D 歌词、自定义背景+WE、更新器+全局快捷键 → DIY 面板删除
visual-contract.test.ts（依赖旧项目 ../public）→ 删掉该测试
透明窗口的 FLUX_OPAQUE 环境变量与 e2e 设置 → 一并清除
完成定义（DoD）
按 CLAUDE.md：pnpm typecheck → pnpm test → pnpm build && pnpm smoke 全绿。 （注意：node scripts/smoke.mjs --legacy 这一步随 legacy 删除而移除，冒烟只剩标准模式。）

阶段 1 —— legacy 模式整体删除
删除文件
src/preload/legacy.ts
scripts/sync-legacy.mjs
legacy/ 目录（gitignored 生成物）
编辑
src/main/index.ts：删 isLegacyMode 变量（L29）及其所有分支——disabledReason 的 'legacy' 臂（L110）、isolatedRuntime/静态根/preload 路径的 legacy 判断（L125/L177-192/L198）、startLocalServer 的 legacyMode（L207）、!isLegacyMode && 守卫（L214/L294）、冒烟日志 legacy token（L254）。resolveStaticRoot() 塌缩为只返回 ../renderer；preloadPath() 塌缩为只返回 main.cjs。
electron.vite.config.ts：preload rollup input 去掉 legacy 项（L32），只留 main。
src/server/types.ts：ServerConfig 删 legacyMode?（L20-21）及 staticRoot 注释里的 legacy 字样。
src/server/index.ts：删/硬编码 mode 日志行（L57）。
src/server/routes/misc.ts：/api/app/version 载荷删 legacyMode（L30）。
scripts/smoke.mjs：删 --legacy 处理（L23）与用法注释（L5）。
package.json：删 dev:legacy、sync-legacy 脚本。
.gitignore：删 legacy/。
eslint.config.mjs：ignores 删 'legacy/**'。
legacy 兼容 IPC 通道（仅旧前端用，删除）
src/shared/ipc-contract.ts：删 openUpdateInstaller（mineradio-open-update-installer）、四个 desktopLyrics*（mineradio-desktop-lyrics-*）。
src/main/ipc.ts：删对应 handler（openUpdateInstaller L212-219、desktopLyrics stub L222-223）。
保留 restartApp/configureGlobalHotkeys/globalHotkey（新 renderer 在用）。exportJsonFile/importJsonFile 见阶段 5。
updater legacy 分支
src/main/updater/controller.ts：删 UpdaterRuntimeMode.isLegacy（L21）、DISABLED_MESSAGES.legacy（L36）、if (mode.isLegacy) return 'legacy'（L102）。
src/shared/updater-contract.ts：disabledReason 联合类型去掉 'legacy'（L36）。
src/renderer/src/features/system/SystemMaintenancePanel.tsx：DISABLED map 删 legacy 文案（L24）。
测试
tests/unit/updater-controller.test.ts：it.each 删 ['legacy', {isLegacy:true}] 行（L249-258）。
tests/e2e/electron.fixture.ts：删 delete env.FLUX_LEGACY（L58）。
阶段 2 —— 透明窗口删除（窗口恒定不透明）
src/main/windows/main-window.ts：
createMainWindow()：删 preferTransparent/FLUX_OPAQUE 读取（L196），直接 buildAndLoad(false)；去掉 transparent 参数传递。
buildAndLoad()：删整个 if (transparent) { … 重建降级 … } 块（L218-228）；保留 loadURL+15s 超时竞速作为通用安全网，catch 塌缩为仅日志。
buildWindow()：删 transparent 参数；backgroundColor 硬编码 '#0b0d12'（L243-244）。
保留 didWindowLoad/loadedWindows（冒烟用）、render-process-gone（诊断用）。
tests/e2e/electron.fixture.ts：删 env.FLUX_OPAQUE = '1'（L76）。
src/renderer/src/styles/global.css：删 body 的 border-radius: 12px（L37，透明窗口才可见的圆角，现窗口为矩形）。
注意：visual/stage.ts 的 canvas.style.background='transparent' 与各 Three.js material 的 transparent:true 是 WebGL alpha，不动。
阶段 3 —— 3D 歌单架（visual/shelf）删除
关键事实：左右 DOM 面板（ShelfDetailPanel/handleShelfAction）只是复用了 "shelf" 命名，不依赖 3D 层；handleShelfAction 实际只用 action.index，传入的 item 全被忽略。

删除文件
src/renderer/src/visual/shelf/ 整个目录（index.ts 3D 层 + controller.ts）。
编辑
src/renderer/src/visual/stage.ts：删 ShelfLayer import（L16）、字段（L108）、构造块（L254-263/270/272）、tick 内 shelfLayer.update（L311）、公开方法 viewportShelfPointer（L353）与 wheelShelf（L357，本就无人调）。
src/renderer/src/visual/StageCanvas.tsx：删 stage.viewportShelfPointer(...) 调用（L74/107）、onShelfAction/ShelfViewportPointerInput/ShelfAction import 与相关 prop。
src/renderer/src/visual/scene.ts：删 shelfChannel 与 ShelfFrame import（L2/40-45）。
src/renderer/src/App.tsx：删 shelfChannel import（L12）与两处 shelfChannel.set(...)（L1182/1187）；把 ShelfAction 类型依赖去掉——handleShelfAction 签名改为 (index: number) => void，调用点（L1082 restore、L1398 按钮）改为直接传 index；删 import type { ShelfAction } from './visual/shelf'（L13）。ShelfDetailPanel/shelfDetail/shelfPlaylists 等 DOM 数据管线保留（它们用的是本地 ShelfPlaylistDetail 类型，非 shelf 模块）。
若 App 仍需 ShelfItem 结构：确认后就地内联为普通对象字面量（当前调用已是内联对象，无需该类型）。
测试
删 tests/unit/visual-shelf.test.ts、tests/unit/visual-shelf-interaction.test.ts。
阶段 4 —— 天气删除（renderer 无调用）
删文件：src/server/weather/index.ts、src/server/routes/weather.ts、tests/unit/weather.test.ts、tests/fixtures/weather/（整目录）。
src/server/index.ts：删 registerWeatherRoutes import（L8）与调用（L43）。
scripts/record-fixtures.mjs：删 weather 录制段与 CLI scope 的 weather 分支。
阶段 5 —— 其余确认死代码删除（全量清理）
renderer 死代码
src/renderer/src/visual/beat/ 整个目录（离线节拍分析，仅测试引用；实时节拍由 visual/audio/ 的 WebAudio FFT 驱动，不受影响）。删 tests/unit/visual-beat.test.ts、music-tempo.d.ts。
DIY 面板（owner 未勾选保留）：删 src/renderer/src/visual/diy/ 整目录；App.tsx 删 DiyVisualPanel 组件（L426）、createDiyVisualParamsController/DIY_PARAM_LABELS/subscribeDiyVisualParams（L405-424）、渲染点（L1364）、TopBar 的 DIY 按钮（L506）、import（L41-43）。删 tests/unit/visual-diy.test.ts。
⚠️ 需确认 DIY 删除后视觉参数默认值来源：visual/bus.ts 的 VisualParams 默认值独立存在，DIY 只是运行时覆盖端口，删除面板不影响舞台默认渲染。执行时验证 visualBus.setParams 无其它调用方。
src/renderer/src/features/lyrics/LyricsView.tsx（被 3D 歌词取代，未挂载）+ 其 lyrics.css；features/lyrics/index.ts 删 LyricsView/LyricsViewProps 导出（L1-2）。删 tests/unit/lyrics-renderer.test.ts（若仅测 LyricsView —— 执行时确认）。
music-tempo 依赖：删 visual/beat 后确认 src/renderer 再无 music-tempo import → 从 package.json deps 移除。
服务端无人调用路由（route → provider 方法 → sdk 门面 → mapper → fixture 一路删）
misc.ts：删 /api/update/* stub、/api/beatmap/cache*、/api/podcast/*（含 dj-beatmap）；misc.ts 精简到只剩 /api/app/version。删 MiscRouteDependencies.djAnalyzer。
beatmap/：删 src/server/beatmap/ 整目录（analyzer/cache/service/errors/types）；src/server/types.ts 删 ServerConfig.beatCacheDir；src/main/index.ts 删 beatCacheDir（L205）。删 tests/unit/dj-beatmap.test.ts。
netease.ts：删 login/qr/*、discover/home、artist/detail、song/comments、song/like、song/like/check、playlist/create、playlist/add-song 路由及其 provider 方法（loginQr*/discoverHome/artistDetail/songComments/likeCheck/like/playlistCreate/playlistAddSong）与 sdk 门面项、mapDiscoverPlaylist。删对应 fixture/snapshot（personalized.fixture.json、netease-discover-playlists.mapped.json）及 netease-fixture.test.ts/netease-mappers.test.ts 中相关用例；record-fixtures.mjs 的 personalized 段。
qq.ts：删 qq/artist/detail、qq/song/comments 路由及 QQProvider.artistDetail/songComments、mapQQComment；删 singer-songs.fixture.json、qq-singer-songs.mapped.json、qq-fixture.test.ts singer 用例、record-fixtures.mjs singer 段。
保留：likelist（likedTracks 用）、playlist_tracks（若保留 raw fallback）。
更新器 HTTP stub 已随 misc.ts 精简移除；更新走 IPC（保留）。
无人调用的 IPC 能力
exportJsonFile/importJsonFile：renderer 无调用。删 src/main/ipc.ts handler（L134-167）、src/preload/main.ts 暴露（L38-39）、env.d.ts 声明（L21-22）、ipc-contract.ts 通道。（属独立清理，与 legacy 无关，全量清理档一并做。）
阶段 6 —— shader 契约测试与文档
删 tests/unit/visual-contract.test.ts（依赖旧项目 ../public/index.html，路径已不存在）。
更新文档去掉已删功能的描述：
CLAUDE.md：删 legacy 模式、透明窗口降级铁律、FLUX_OPAQUE、dev:legacy/sync-legacy 命令、3D 歌单架/DIY/天气相关表述。
README.md：功能概览、环境变量表、行为差异段同步。
docs/ARCHITECTURE.md：删 §1.2 透明降级、§3 weather/beatmap 路由、§5.6 shelf/beat/diy、legacy 双模式说明、常量表相关项。
验证
pnpm typecheck（node+web 双 tsconfig）—— 重点确认删 ShelfAction/shelfChannel/DIY/beat 后无残留 import。
pnpm test（vitest）—— 删掉的测试文件不再存在；剩余测试全绿。
pnpm build && pnpm smoke —— 标准模式窗口加载 + /api/app/version 自检通过、自动退出。
手动跑 pnpm dev：登录网易云/QQ → 左侧歌单加载 → 点歌单进右侧详情 → 播放 → 中间粒子舞台 + 3D 歌词随歌词显示 → 自定义背景/WE 面板可用 → 更新器面板与全局快捷键正常。
grep -rn "legacy\|FLUX_OPAQUE\|weather\|shelf\|beatmap\|dj-beatmap\|DiyVisual" src 复查无功能性残留（保留 LEGACY_COMPARISON.md provenance 与 legacyEase 等核心资产字节搬迁标记——铁律保护，不动）。
执行顺序建议
阶段 3（shelf）与阶段 5（DIY/beat）改动 stage.ts/App.tsx 有重叠，建议串行：先 1→2（主进程/构建，风险低），再 3→5（renderer 大改，每阶段单独 typecheck），最后 4（server）、6（测试/文档）。每阶段一个小 git 提交。
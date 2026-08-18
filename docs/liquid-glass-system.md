# FluxPlayer 全局液态玻璃系统

## 单一配置源

全局玻璃由 `src/renderer/src/components/glass` 独立维护：

- `config.ts`：类型、默认值、安全范围、归一化与 CSS 变量映射。
- `persistence.ts`：`fluxplayer-glass-v1` 版本信封和字段级容错。
- `store.ts`：Zustand store、按帧预览合并、提交和恢复默认。
- `surface.tsx`：业务代码唯一允许使用的 `react-glass-ui` 适配层。
- `glass.css`：稳定尺寸、贴边几何、第三方层级和 View Transition 规则。

设置入口是“设置 > 玻璃”。`previewConfig` 每个动画帧最多更新一次，`commitConfig` 同步刷新最终值并只写一次 localStorage。颜色仅接受 `#RRGGBB` 或 `#RRGGBBAA`；损坏、越界和缺失字段分别回退，不会让整份配置失效。

## 默认配置

```ts
{
  blur: 3,
  distortion: 40,
  flexibility: 0,
  borderColor: '#ffffff',
  borderSize: 1,
  borderRadius: 30,
  borderOpacity: 0.4,
  backgroundColor: '#000000ff',
  backgroundOpacity: 0,
  innerLightColor: '#ffffff',
  innerLightSpread: 1,
  innerLightBlur: 10,
  innerLightOpacity: 0,
  outerLightColor: '#ffffff',
  outerLightSpread: 1,
  outerLightBlur: 10,
  outerLightOpacity: 0,
  color: '#ffffff',
  chromaticAberration: 0,
  onHoverScale: 1,
  saturation: 100,
  brightness: 100,
}
```

`flexibility` 和 `onHoverScale` 为兼容序列化格式而保留，但运行时永远归一化为 `0` 和 `1`。业务代码和设置界面不能开启第三方 hover transform。

## 安全范围

| 配置                     | 范围   |
| ------------------------ | ------ |
| blur                     | 0–40   |
| distortion               | 0–100  |
| saturation               | 50–200 |
| brightness               | 50–150 |
| chromaticAberration      | 0–20   |
| borderRadius             | 0–60   |
| borderSize               | 0–4    |
| inner/outer light spread | 0–20   |
| inner/outer light blur   | 0–80   |
| 所有 opacity             | 0–1    |

## 表面清单

下列容器必须使用一个 `GlassSurface`，并消费同一份 `data-glass-config`：

- 左侧音乐库和右侧歌单详情栏
- PlayerBar
- 搜索输入壳和搜索结果浮层
- SettingsPanel
- Wallpaper Engine 项目库对话框
- GlassSelect portal 浮层

Tabs、列表项、系统维护内容和设置分组不得再嵌套真实 GlassCard。`glassSoft`、`glassRaised` 等小型控件保留轻量 CSS 实现，消费全局玻璃颜色、透明度、边框和派生圆角；它们不创建 SVG displacement filter。

`DialogContent`、`SheetContent` 和 `Card` 是透明结构层。Overlay 只提供遮罩色，不先模糊背景。贴边面板将真实卡片向视口外扩展一个 `--flux-glass-radius`，因此贴边侧被视口裁平，自由侧仍保留全局圆角和外光。

## 层级和动画约束

- `GlassSurface` 只渲染透明语义包装层和一个真实 GlassCard。
- 实时 `.glass-ui-container` 及其祖先不得动态修改 `transform`；GlassCard 固定 `transform:none`。
- GlassCard 及其稳定祖先不使用 `isolation:isolate`、`filter`、`mix-blend-mode` 或非 1 `opacity`。第三方 backdrop-filter 位于卡片子层，这些属性会建立 Backdrop Root 并截断它对应用背景的采样。raised 阴影必须使用 `box-shadow`，适配 CSS 通过显式 z-index 保持层级。
- 左右栏和搜索壳只移动 View Transition 位图；同一时间只允许一个全局 View Transition。无 API 时 GSAP 只降级为 `autoAlpha`。
- Dialog、Sheet、搜索结果和 GlassSelect 的玻璃根只动画 `autoAlpha`。
- PlayerBar 的玻璃根静止，歌曲变化只动画内部内容。
- 所有 GSAP tween 使用 `overwrite:'auto'`，组件卸载时清理；reduced-motion 直接进入最终状态。

## 第三方补丁

`react-glass-ui@1.2.2` 由 `patches/react-glass-ui@1.2.2.patch` 固定：

- `flexibility=0` 时不注册 hover/touch 监听器，不设置 transform transition 和常驻 will-change。
- 静态卡片的内外光阴影直接由本次 props 计算，不通过 effect 再触发第二次渲染。
- 项目 CSS 关闭背景和光照层自带的 transition/will-change。

升级该依赖时必须重新验证 patch、所有配置字段的实时同步、移入前后边界矩形和静态背景像素稳定性。

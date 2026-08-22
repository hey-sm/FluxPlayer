export const DYNAMIC_BACKGROUND_EFFECTS = ['html-light', 'caustic', 'rain'] as const
export type DynamicBackgroundEffect = (typeof DYNAMIC_BACKGROUND_EFFECTS)[number]

export const DYNAMIC_BACKGROUND_OPTIONS: ReadonlyArray<{
  value: DynamicBackgroundEffect
  label: string
  description: string
}> = Object.freeze([
  { value: 'html-light', label: '吊灯', description: '物理摆动 · 暖色聚光' },
  { value: 'caustic', label: '水纹', description: '可平铺水波焦散 · 主题着色' },
  { value: 'rain', label: '雨窗', description: '雨打玻璃 · 心形故事 · 自动循环' },
])

export function isDynamicBackgroundEffect(value: unknown): value is DynamicBackgroundEffect {
  return typeof value === 'string' && DYNAMIC_BACKGROUND_EFFECTS.includes(value as DynamicBackgroundEffect)
}

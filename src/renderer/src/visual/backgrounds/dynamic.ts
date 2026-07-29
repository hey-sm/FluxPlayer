export const DYNAMIC_BACKGROUND_EFFECTS = ['light-rays', 'html-light', 'galaxy'] as const
export type DynamicBackgroundEffect = (typeof DYNAMIC_BACKGROUND_EFFECTS)[number]

export const DYNAMIC_BACKGROUND_OPTIONS: ReadonlyArray<{
  value: DynamicBackgroundEffect
  label: string
  description: string
}> = Object.freeze([
  { value: 'light-rays', label: '光线', description: '顶部流光 · 鼠标跟随' },
  { value: 'html-light', label: '吊灯', description: '物理摆动 · 暖色聚光' },
  { value: 'galaxy', label: '星系', description: '螺旋星云 · 极慢自转' },
])

export function isDynamicBackgroundEffect(value: unknown): value is DynamicBackgroundEffect {
  return typeof value === 'string' && DYNAMIC_BACKGROUND_EFFECTS.includes(value as DynamicBackgroundEffect)
}

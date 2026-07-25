export const DYNAMIC_BACKGROUND_EFFECTS = ['light-rays', 'galaxy', 'html-light'] as const
export type DynamicBackgroundEffect = (typeof DYNAMIC_BACKGROUND_EFFECTS)[number]

export const DYNAMIC_BACKGROUND_OPTIONS: ReadonlyArray<{
  value: DynamicBackgroundEffect
  label: string
  description: string
}> = Object.freeze([
  { value: 'light-rays', label: '光线', description: '顶部流光 · 鼠标跟随' },
  { value: 'galaxy', label: '星河', description: '深空星群 · 鼠标排斥' },
  { value: 'html-light', label: '吊灯', description: '物理摆动 · 暖色聚光' },
])

export function isDynamicBackgroundEffect(value: unknown): value is DynamicBackgroundEffect {
  return typeof value === 'string' && DYNAMIC_BACKGROUND_EFFECTS.includes(value as DynamicBackgroundEffect)
}

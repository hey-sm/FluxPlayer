export const LYRICS_ANIMATION_MODES = ['compact', 'fade', 'lift', 'focus'] as const

export type LyricsAnimationMode = (typeof LYRICS_ANIMATION_MODES)[number]

export interface LyricsAnimationProfile {
  readonly radius: number
  readonly lineGap: number
  readonly contextOpacity: number
  readonly contextOpacityStep: number
  readonly activeZ: number
  readonly inactiveZ: number
  readonly depthStep: number
  readonly rotationStep: number
  readonly enterOffsetY: number
  readonly enterOffsetZ: number
  readonly enterScale: number
  readonly exitOffsetY: number
  readonly exitOffsetZ: number
  readonly exitScale: number
  readonly duration: number
  readonly enterEase: string
  readonly exitEase: string
}

export const LYRICS_ANIMATION_OPTIONS: ReadonlyArray<{
  value: LyricsAnimationMode
  label: string
  description: string
}> = [
  {
    value: 'compact',
    label: '紧凑滚动',
    description: '显示前后歌词，以更紧凑的行距平滑滚动。',
  },
  {
    value: 'fade',
    label: '柔和淡入',
    description: '弱化空间位移，让当前歌词以淡入聚焦。',
  },
  {
    value: 'lift',
    label: '上浮切换',
    description: '新歌词从下方进入，旧歌词向上退出。',
  },
  {
    value: 'focus',
    label: '仅当前歌词',
    description: '隐藏上下文，新旧歌词使用覆盖交叉过渡。',
  },
]

export const LYRICS_ANIMATION_PROFILES: Readonly<
  Record<LyricsAnimationMode, LyricsAnimationProfile>
> = {
  compact: {
    radius: 2,
    lineGap: 0.46,
    contextOpacity: 0.28,
    contextOpacityStep: 0.07,
    activeZ: 0.18,
    inactiveZ: -0.08,
    depthStep: 0.11,
    rotationStep: 0.04,
    enterOffsetY: -0.08,
    enterOffsetZ: -0.12,
    enterScale: 0.94,
    exitOffsetY: 0.08,
    exitOffsetZ: -0.12,
    exitScale: 0.96,
    duration: 0.3,
    enterEase: 'power2.out',
    exitEase: 'power1.in',
  },
  fade: {
    radius: 2,
    lineGap: 0.44,
    contextOpacity: 0.22,
    contextOpacityStep: 0.05,
    activeZ: 0.12,
    inactiveZ: -0.05,
    depthStep: 0.06,
    rotationStep: 0,
    enterOffsetY: 0,
    enterOffsetZ: -0.04,
    enterScale: 0.98,
    exitOffsetY: 0,
    exitOffsetZ: -0.06,
    exitScale: 0.98,
    duration: 0.26,
    enterEase: 'power1.out',
    exitEase: 'power1.in',
  },
  lift: {
    radius: 2,
    lineGap: 0.46,
    contextOpacity: 0.24,
    contextOpacityStep: 0.06,
    activeZ: 0.16,
    inactiveZ: -0.08,
    depthStep: 0.1,
    rotationStep: 0.025,
    enterOffsetY: -0.18,
    enterOffsetZ: -0.08,
    enterScale: 0.95,
    exitOffsetY: 0.18,
    exitOffsetZ: -0.12,
    exitScale: 0.97,
    duration: 0.32,
    enterEase: 'power2.out',
    exitEase: 'power2.in',
  },
  focus: {
    radius: 0,
    lineGap: 0,
    contextOpacity: 0,
    contextOpacityStep: 0,
    activeZ: 0.18,
    inactiveZ: 0.18,
    depthStep: 0,
    rotationStep: 0,
    enterOffsetY: -0.06,
    enterOffsetZ: -0.03,
    enterScale: 0.94,
    exitOffsetY: 0.06,
    exitOffsetZ: 0.03,
    exitScale: 1.04,
    duration: 0.28,
    enterEase: 'power2.out',
    exitEase: 'power1.in',
  },
}

export function isLyricsAnimationMode(value: unknown): value is LyricsAnimationMode {
  return typeof value === 'string' && LYRICS_ANIMATION_MODES.includes(value as LyricsAnimationMode)
}

export function lyricsAnimationProfile(mode: LyricsAnimationMode): LyricsAnimationProfile {
  return LYRICS_ANIMATION_PROFILES[mode]
}

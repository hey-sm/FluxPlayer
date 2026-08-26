export const LYRICS_ANIMATION_MODES = ['compact', 'cascade', 'cinematic'] as const

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
  /**
   * 逐字浮现的位移幅度（em，0 = 关闭）。靠 geometry 自带的 glyphIndex 属性在顶点着色器里
   * 给每个字错开延迟，纯 GPU 计算，不额外拆 mesh。
   */
  readonly glyphCascade: number
}

export const LYRICS_ANIMATION_OPTIONS: ReadonlyArray<{
  value: LyricsAnimationMode
  label: string
  description: string
}> = [
  {
    value: 'compact',
    label: '紧凑滚动',
    description: '更宽的上下文窗口，行距紧凑，平滑滚动铺满视野。',
  },
  {
    value: 'cascade',
    label: '逐字浮现',
    description: '当前句的每个字依次大幅向上浮起并点亮，逐字歌词观感最强。',
  },
  {
    value: 'cinematic',
    label: '景深推进',
    description: '新歌词自更远处的远景推近，旧歌词大幅越过镜头掠出，纵深感最强。',
  },
]

export const LYRICS_ANIMATION_PROFILES: Readonly<Record<LyricsAnimationMode, LyricsAnimationProfile>> = {
  compact: {
    // 行距加宽到 0.56，多行歌词间距舒展；radius 降回 2（5 行）避免超视野
    radius: 2,
    lineGap: 0.56,
    contextOpacity: 0.3,
    contextOpacityStep: 0.05,
    activeZ: 0.16,
    inactiveZ: -0.06,
    depthStep: 0.09,
    rotationStep: 0.03,
    // 行位移维持温和：紧凑滚动的核心是平滑，不要让位移喧宾夺主
    enterOffsetY: -0.06,
    enterOffsetZ: -0.1,
    enterScale: 0.96,
    exitOffsetY: 0.06,
    exitOffsetZ: -0.1,
    exitScale: 0.98,
    duration: 0.32,
    enterEase: 'power2.out',
    exitEase: 'power1.in',
    glyphCascade: 0,
  },
  cascade: {
    radius: 2,
    // 行距 0.46→0.56：与紧凑滚动一致，逐字浮现时多行间距舒展
    lineGap: 0.56,
    contextOpacity: 0.26,
    contextOpacityStep: 0.06,
    activeZ: 0.22,
    inactiveZ: -0.08,
    depthStep: 0.11,
    rotationStep: 0.025,
    // 行整体几乎不位移，位移交给逐字动画
    enterOffsetY: -0.02,
    enterOffsetZ: -0.05,
    enterScale: 0.99,
    exitOffsetY: 0.1,
    exitOffsetZ: -0.16,
    exitScale: 1.06,
    duration: 0.5,
    enterEase: 'power2.out',
    exitEase: 'power1.in',
    // 逐字位移幅度 0.5→0.85：每个字向上浮起的高度更明显，逐字感更强
    glyphCascade: 0.85,
  },
  cinematic: {
    // 景深推进上下文多了会互相遮挡，保持 radius 2
    radius: 2,
    lineGap: 0.54,
    contextOpacity: 0.16,
    contextOpacityStep: 0.05,
    activeZ: 0.4,
    inactiveZ: -0.4,
    depthStep: 0.28,
    rotationStep: 0.07,
    enterOffsetY: -0.1,
    // 从更远处推近，纵深感拉满
    enterOffsetZ: -0.95,
    enterScale: 0.64,
    // 退出更大幅度朝镜头推并放大，掠过镜头感更强
    exitOffsetY: 0.14,
    exitOffsetZ: 0.7,
    exitScale: 1.28,
    duration: 0.5,
    enterEase: 'power3.out',
    exitEase: 'power2.in',
    glyphCascade: 0,
  },
}

/**
 * 「只显示当前歌词」下的切句编排。
 *
 * 窗口模式里当前句从不真正退出 —— 它滚到 -1 槽位，只有窗口最外沿那句（opacity 已经掉到
 * contextOpacity 的底部）才走 exit 补间，所以 profile 的 exitOffsetY（compact 0.06，约行距的
 * 16%）完全够用。焦点模式没有邻居接手：退出的就是屏幕正中那句满不透明的行，而新句也停在
 * relativeIndex 0，同一套参数等于"原地淡出"—— 补间中段两句都还有 ~0.7 alpha 精确叠在一起，
 * 这就是切句残影。
 *
 * 所以焦点模式单开一套：位移放大到真正让出一个行位，alpha 抢在位移前面走完，新句 alpha 再
 * 延后一点点，保证任何一帧只有一句是可读的。方向和 z/scale 仍沿用各模式自己的 exit* 参数，
 * 景深推进的"掠过镜头"观感不受影响。
 */
export const LYRICS_FOCUS_SWITCH = {
  /** 退出位移 = lineGap × 此系数 */
  exitSpan: 1.25,
  /** 退出补间时长 = profile.duration × 此系数 */
  exitDuration: 0.7,
  /** 退出 alpha 只占退出时长的这一段，剩下的位移在不可见状态下跑完 */
  exitFadeRatio: 0.5,
  /** 入场 alpha 延迟 = profile.duration × 此系数 */
  enterFadeDelay: 0.24,
  /** alpha 要"立刻掉、立刻起"，必须用 out 系；in 系会让旧句在高 alpha 上多挂一阵 */
  fadeEase: 'power2.out',
} as const

export function isLyricsAnimationMode(value: unknown): value is LyricsAnimationMode {
  return typeof value === 'string' && LYRICS_ANIMATION_MODES.includes(value as LyricsAnimationMode)
}

export function lyricsAnimationProfile(mode: LyricsAnimationMode): LyricsAnimationProfile {
  return LYRICS_ANIMATION_PROFILES[mode]
}

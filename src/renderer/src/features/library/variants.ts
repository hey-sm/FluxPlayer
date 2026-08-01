import { cva } from 'class-variance-authority'

export const providerTabVariants = cva(
  'h-8 cursor-pointer rounded-[var(--flux-radius-control)] border px-[13px] text-xs transition-colors duration-[var(--motion-duration-fast)]',
  {
    variants: {
      active: {
        true: 'border-[color-mix(in_srgb,var(--flux-accent)_32%,transparent)] bg-[var(--flux-accent-soft)] text-[var(--flux-text)]',
        false:
          'border-transparent bg-transparent text-[var(--flux-text-muted)] hover:border-[color-mix(in_srgb,var(--flux-accent)_18%,transparent)] hover:text-[var(--flux-text)]',
      },
    },
    defaultVariants: { active: false },
  },
)

/** 歌单分组（自建/收藏）标签；比 providerTabVariants 更矮，不跟平台 tab 抢视觉层级 */
export const playlistTabVariants = cva(
  'h-7 cursor-pointer rounded-[var(--flux-radius-control)] border px-2.5 text-[11px] transition-colors duration-[var(--motion-duration-fast)]',
  {
    variants: {
      active: {
        true: 'border-[color-mix(in_srgb,var(--flux-accent)_28%,transparent)] bg-[var(--flux-accent-soft)] text-[var(--flux-text)]',
        false:
          'border-transparent bg-transparent text-[var(--flux-text-muted)] hover:text-[var(--flux-text)]',
      },
    },
    defaultVariants: { active: false },
  },
)

/** 快捷入口：图标 + 名称 + 右侧数量的一行；和歌单行一样保持无边框，只靠背景反馈 */
export const libraryShortcutVariants = cva([
  'flex min-h-[38px] cursor-pointer items-center gap-2.5 rounded-[10px]',
  'bg-transparent px-2.5 py-1.5 text-left text-[13px] text-[var(--flux-text)]',
  'transition-colors duration-[var(--motion-duration-fast)] hover:bg-[var(--flux-accent-soft)]',
  'disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent',
])

export const libraryRowVariants = cva(
  [
    'grid cursor-pointer items-center gap-2.5 bg-transparent text-left text-[var(--flux-text)]',
    'transition-colors duration-[var(--motion-duration-fast)] hover:bg-[var(--flux-accent-soft)]',
    'data-[selected=true]:bg-[var(--flux-accent-soft)]',
    'data-[focused=true]:bg-[color-mix(in_srgb,var(--flux-accent)_12%,transparent)]',
  ],
  {
    variants: {
      layout: {
        playlist: 'min-h-14 grid-cols-[44px_minmax(0,1fr)] rounded-[11px] p-1.5',
        detail: 'grid-cols-[42px_minmax(0,1fr)] rounded-[10px] p-[7px]',
      },
    },
    defaultVariants: { layout: 'playlist' },
  },
)

export const libraryStatusVariants = cva('grid min-h-[88px] place-items-center text-center text-sm', {
  variants: {
    tone: {
      neutral: 'text-[var(--flux-text-muted)]',
      danger: 'text-[var(--flux-danger)]',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

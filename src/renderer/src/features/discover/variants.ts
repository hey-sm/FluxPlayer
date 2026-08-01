import { cva } from 'class-variance-authority'

/** 发现区块的卡片：三张一行等分铺满，不再固定宽度也不横向滚动。 */
export const discoverCardVariants = cva([
  'flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-[11px] border border-transparent',
  'bg-transparent p-1.5 text-left text-[var(--flux-text)]',
  'transition-colors duration-[var(--motion-duration-fast)]',
  'hover:border-[color-mix(in_srgb,var(--flux-accent)_28%,transparent)] hover:bg-[var(--flux-accent-soft)]',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--flux-accent)]',
])

export const discoverSectionTitleVariants = cva(
  'mb-1.5 px-0.5 text-[11px] font-medium tracking-wide text-[var(--flux-text-muted)]',
)

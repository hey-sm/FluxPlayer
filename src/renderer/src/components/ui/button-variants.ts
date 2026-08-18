import { cva } from 'class-variance-authority'

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:pointer-events-none [&_svg]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:brightness-110',
        destructive: 'bg-destructive text-white hover:brightness-110',
        outline:
          'border border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        ghost: 'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
        glassSoft: [
          'border border-[var(--flux-glass-border)] bg-[var(--flux-glass-background)]',
          'text-[var(--flux-glass-color)] [font-family:var(--flux-font-family)]',
          'transition-[border-color,background-color] duration-[var(--motion-duration-fast)] motion-reduce:transition-none',
          'hover:not-disabled:border-[color-mix(in_srgb,var(--flux-accent)_45%,transparent)]',
          'hover:not-disabled:bg-[var(--flux-accent-soft)]',
          'focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-[color-mix(in_srgb,var(--flux-accent)_58%,transparent)]',
          'disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-45',
        ],
        glassRaised: [
          'cursor-pointer border border-[var(--flux-glass-border)]',
          'bg-[var(--flux-glass-background)]',
          'text-[var(--flux-glass-color)] [font-family:var(--flux-font-family)]',
          'transition-[border-color,background-color,color,transform] duration-[var(--motion-duration-fast)] motion-reduce:transition-none',
          'hover:not-disabled:-translate-y-px hover:not-disabled:border-[color-mix(in_srgb,var(--flux-accent)_42%,transparent)]',
          'hover:not-disabled:bg-[color-mix(in_srgb,var(--flux-accent)_18%,var(--flux-panel-surface))]',
          'focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-[color-mix(in_srgb,var(--flux-accent)_72%,white_8%)]',
          'disabled:pointer-events-auto disabled:cursor-not-allowed',
          'disabled:text-[color-mix(in_srgb,var(--flux-text-muted)_66%,transparent)] disabled:opacity-52',
        ],
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6',
        icon: 'size-9',
        'icon-sm': 'size-8',
        compact: 'h-auto min-h-[30px] rounded-[var(--flux-radius-control)] px-2.5 py-0 text-[11px]',
        preview:
          'h-auto min-w-0 flex-col items-stretch overflow-hidden rounded-[var(--flux-radius-control)] p-0 text-left',
        action:
          'h-auto min-h-[2.1rem] rounded-[calc(var(--flux-glass-radius)*0.65)] px-[0.78rem] py-[0.48rem] text-[0.7rem] font-semibold',
      },
      emphasis: {
        default: '',
        primary: '',
      },
    },
    compoundVariants: [
      {
        variant: 'glassRaised',
        emphasis: 'primary',
        class: [
          'border-[color-mix(in_srgb,var(--flux-accent)_26%,transparent)]',
          'bg-[color-mix(in_srgb,var(--flux-accent)_14%,var(--flux-panel-surface))]',
        ],
      },
    ],
    defaultVariants: { variant: 'default', size: 'default', emphasis: 'default' },
  },
)

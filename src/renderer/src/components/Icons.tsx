import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export const PreviousIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M6 5v14" />
    <path d="m18 6-8 6 8 6z" />
  </IconBase>
)
export const NextIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M18 5v14" />
    <path d="m6 6 8 6-8 6z" />
  </IconBase>
)
export const PlayIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m8 5 11 7-11 7z" />
  </IconBase>
)
export const PauseIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M9 5v14M15 5v14" />
  </IconBase>
)
export const RepeatIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m17 2 3 3-3 3" />
    <path d="M3 11V9a4 4 0 0 1 4-4h13" />
    <path d="m7 22-3-3 3-3" />
    <path d="M21 13v2a4 4 0 0 1-4 4H4" />
  </IconBase>
)
export const RepeatOneIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m17 2 3 3-3 3" />
    <path d="M3 11V9a4 4 0 0 1 4-4h13" />
    <path d="m7 22-3-3 3-3" />
    <path d="M21 13v2a4 4 0 0 1-4 4H4" />
    <path d="M12 9v6" />
  </IconBase>
)
export const ShuffleIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M3 6h2c5 0 7 12 12 12h4" />
    <path d="m18 15 3 3-3 3" />
    <path d="M3 18h2c2.2 0 3.8-2.3 5.4-5" />
    <path d="M14 8.5C15 7 16 6 17 6h4" />
    <path d="m18 3 3 3-3 3" />
  </IconBase>
)
export const SettingsIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.36.25.72.6 1 .6h.1v4h-.1a1.7 1.7 0 0 0-1 .4z" />
  </IconBase>
)
export const ChevronLeftIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m15 18-6-6 6-6" />
  </IconBase>
)
export const ChevronRightIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m9 18 6-6-6-6" />
  </IconBase>
)

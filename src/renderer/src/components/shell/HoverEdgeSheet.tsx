import { cva } from 'class-variance-authority'
import { useEffect, useRef, type ReactNode } from 'react'
import { glassSurfaceVariants } from '../glass/surface'
import { AnimatedContent } from '../react-bits/AnimatedContent'
import { cn } from '@/lib/utils'

export interface HoverEdgeSheetProps {
  side: 'left' | 'right'
  open: boolean
  available?: boolean
  onOpenChange(open: boolean): void
  children: ReactNode
}

const edgeSheetVariants = cva(
  [
    'fixed top-[var(--flux-topbar-height)] bottom-[104px] z-[78]',
    'h-auto min-h-0 w-[min(340px,32vw)] overflow-hidden opacity-100',
    'group-data-[focus-mode=true]/app:hidden',
    '[@media(max-height:560px)]:bottom-[88px]',
  ],
  {
    variants: {
      side: {
        left: 'left-0',
        right: 'right-0',
      },
    },
  },
)

const edgeSensorVariants = cva(
  [
    'fixed top-[calc(25vh+10px)] z-[77]',
    'h-[max(44px,calc(50vh-76px))] w-[min(170px,16vw)]',
    '[-webkit-app-region:no-drag] group-data-[focus-mode=true]/app:hidden',
    '[@media(max-height:560px)]:top-[calc(25vh+14px)]',
    '[@media(max-height:560px)]:h-[max(44px,calc(50vh-68px))]',
  ],
  {
    variants: {
      side: {
        left: 'left-0',
        right: 'right-0',
      },
    },
  },
)

export function HoverEdgeSheet({
  side,
  open,
  available = true,
  onOpenChange,
  children,
}: HoverEdgeSheetProps): React.JSX.Element {
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }

  const scheduleClose = (): void => {
    cancelClose()
    closeTimer.current = setTimeout(() => onOpenChange(false), 2000)
  }

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    [],
  )

  return (
    <>
      <div
        className={edgeSensorVariants({ side })}
        data-edge-sheet-sensor=""
        data-side={side}
        aria-hidden="true"
        onPointerEnter={() => {
          cancelClose()
          if (available) onOpenChange(true)
        }}
      />
      <AnimatedContent
        visible={open}
        direction="horizontal"
        reverse={side === 'left'}
        className={cn(
          edgeSheetVariants({ side }),
          glassSurfaceVariants({ treatment: 'classicPanel', edge: side }),
          // Only the bottom edge is stroked. The classic panel ships an all-around inset ring, so the
          // stroke is expressed as a single inset shadow line instead of a border that ring would fight.
          '[box-shadow:inset_0_-1px_0_0_var(--flux-glass-border),0_16px_48px_rgba(17,17,26,0.12)]',
        )}
        data-edge-sheet=""
        data-side={side}
        data-treatment="classicPanel"
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
      >
        <div className="flex h-full">{children}</div>
      </AnimatedContent>
    </>
  )
}

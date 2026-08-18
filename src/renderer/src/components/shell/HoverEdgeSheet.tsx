import { cva } from 'class-variance-authority'
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { GlassSurface } from '../glass'
import { gsap, motionDurations, motionEases, useReducedMotion } from '../../motion'

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
    'h-auto min-h-0 w-[min(340px,32vw)] opacity-100',
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
  const sheetRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()

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

  useLayoutEffect(() => {
    const sheet = sheetRef.current
    const content = sheet?.querySelector<HTMLElement>('.flux-glass-surface__content')
    if (!sheet) return
    const closedClip = side === 'left' ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)'
    const contentOffset = side === 'left' ? -18 : 18
    if (reducedMotion) {
      gsap.set(sheet, {
        clipPath: open ? 'inset(0 0% 0 0)' : closedClip,
        visibility: open ? 'visible' : 'hidden',
      })
      if (content) gsap.set(content, { x: 0 })
      delete sheet.dataset.animationState
      return
    }

    if (open) gsap.set(sheet, { visibility: 'visible' })
    gsap.to(sheet, {
      clipPath: open ? 'inset(0 0% 0 0)' : closedClip,
      duration: open ? motionDurations.base : motionDurations.fast,
      ease: open ? motionEases.enter : motionEases.exit,
      overwrite: 'auto',
      onComplete: () => {
        if (!open) gsap.set(sheet, { visibility: 'hidden' })
        delete sheet.dataset.animationState
      },
    })
    if (content) {
      gsap.to(content, {
        x: open ? 0 : contentOffset,
        duration: open ? motionDurations.base : motionDurations.fast,
        ease: open ? motionEases.enter : motionEases.exit,
        overwrite: 'auto',
      })
    }
    return () => {
      gsap.killTweensOf(sheet)
      if (content) gsap.killTweensOf(content)
    }
  }, [open, reducedMotion, side])

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
      <div
        ref={sheetRef}
        className={edgeSheetVariants({ side })}
        data-edge-sheet=""
        data-side={side}
        data-animation-direction="horizontal"
        data-animation-reverse={side === 'left'}
        data-animation-effect="live-clip-reveal"
        data-animation-state={open ? 'enter' : 'exit'}
        aria-hidden={!open || undefined}
        style={{
          visibility: open ? 'visible' : 'hidden',
          pointerEvents: open ? 'auto' : 'none',
          clipPath: side === 'left' ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)',
        }}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
      >
        <GlassSurface edge={side} className="size-full" data-edge-sheet-glass="">
          {children}
        </GlassSurface>
      </div>
    </>
  )
}

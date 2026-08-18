import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { gsap, motionDurations, motionEases, useGSAP, useReducedMotion } from '@/motion'
import { buttonVariants } from './button-variants'

interface SheetMotionContextValue {
  open: boolean
  present: boolean
  completeExit(): void
}

const SheetMotionContext = React.createContext<SheetMotionContextValue | null>(null)

type SheetProps = React.ComponentProps<typeof DialogPrimitive.Root>

function Sheet({ open: controlledOpen, defaultOpen, onOpenChange, children, ...props }: SheetProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false)
  const open = controlledOpen ?? uncontrolledOpen
  const [present, setPresent] = React.useState(open)
  const openRef = React.useRef(open)
  const wasOpenRef = React.useRef(false)
  const restoreFocusRef = React.useRef<HTMLElement | null>(null)
  openRef.current = open

  React.useLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setPresent(true)
    }
    wasOpenRef.current = open
  }, [open])

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(nextOpen)
      onOpenChange?.(nextOpen)
    },
    [controlledOpen, onOpenChange],
  )

  const completeExit = React.useCallback(() => {
    if (openRef.current) return
    setPresent(false)
    const restoreTarget = restoreFocusRef.current
    window.requestAnimationFrame(() => restoreTarget?.focus({ preventScroll: true }))
  }, [])

  const motionState = React.useMemo(() => ({ open, present, completeExit }), [completeExit, open, present])

  return (
    <SheetMotionContext.Provider value={motionState}>
      <DialogPrimitive.Root {...props} open={open} onOpenChange={handleOpenChange}>
        {children}
      </DialogPrimitive.Root>
    </SheetMotionContext.Provider>
  )
}

const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close
const SheetPortal = DialogPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-sheet-motion-overlay=""
    className={cn('fixed inset-x-0 bottom-0 top-[var(--flux-topbar-height)] z-[60] bg-black/25', className)}
    {...props}
  />
))
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName

type SheetSide = 'left' | 'right'
type SheetContentProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  'forceMount'
> & {
  side?: SheetSide
}

const SheetContent = React.forwardRef<React.ComponentRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  ({ side = 'right', className, children, ...props }, forwardedRef) => {
    const motionState = React.useContext(SheetMotionContext)
    if (!motionState) throw new Error('SheetContent must be used within Sheet')

    const { open, present, completeExit } = motionState
    const overlayRef = React.useRef<React.ComponentRef<typeof DialogPrimitive.Overlay>>(null)
    const contentRef = React.useRef<React.ComponentRef<typeof DialogPrimitive.Content>>(null)
    const enteredRef = React.useRef(false)
    const reducedMotion = useReducedMotion()

    const setContentRef = React.useCallback(
      (node: React.ComponentRef<typeof DialogPrimitive.Content> | null) => {
        contentRef.current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      },
      [forwardedRef],
    )

    useGSAP(
      () => {
        const overlay = overlayRef.current
        const content = contentRef.current
        if (!present || !overlay || !content) return

        gsap.killTweensOf([overlay, content])
        const timeline = gsap.timeline()

        if (open) {
          if (!enteredRef.current) {
            gsap.set(overlay, { autoAlpha: 0 })
            gsap.set(content, {
              autoAlpha: reducedMotion ? 1 : 0.96,
            })
          }
          enteredRef.current = true
          timeline
            .to(
              overlay,
              {
                autoAlpha: 1,
                duration: reducedMotion ? 0 : motionDurations.base,
                ease: motionEases.enter,
                overwrite: 'auto',
              },
              0,
            )
            .to(
              content,
              {
                autoAlpha: 1,
                duration: reducedMotion ? 0 : motionDurations.emphasized,
                ease: motionEases.enter,
                overwrite: 'auto',
              },
              0,
            )
        } else {
          timeline
            .to(
              content,
              {
                autoAlpha: reducedMotion ? 1 : 0.96,
                duration: reducedMotion ? 0 : motionDurations.base,
                ease: motionEases.exit,
                overwrite: 'auto',
              },
              0,
            )
            .to(
              overlay,
              {
                autoAlpha: 0,
                duration: reducedMotion ? 0 : motionDurations.base,
                ease: motionEases.exit,
                overwrite: 'auto',
              },
              0,
            )
            .eventCallback('onComplete', () => {
              enteredRef.current = false
              completeExit()
            })
        }

        return () => {
          timeline.kill()
          gsap.killTweensOf([overlay, content])
        }
      },
      {
        scope: contentRef,
        dependencies: [completeExit, open, present, reducedMotion],
      },
    )

    if (!present) return null

    return (
      <SheetPortal forceMount>
        <SheetOverlay ref={overlayRef} forceMount />
        <DialogPrimitive.Content
          ref={setContentRef}
          forceMount
          data-side={side}
          data-sheet-motion-content=""
          className={cn(
            'fixed bottom-0 top-[var(--flux-topbar-height)] z-[61] flex h-[calc(100dvh-var(--flux-topbar-height))] flex-col border-0 bg-transparent text-popover-foreground shadow-none outline-none',
            side === 'left'
              ? 'left-0 w-[min(360px,calc(100vw-24px))]'
              : 'right-0 w-[min(440px,calc(100vw-24px))]',
            className,
          )}
          {...props}
        >
          {children}
          <DialogPrimitive.Close
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
              'absolute right-3 top-3 size-7 text-muted-foreground',
            )}
          >
            <X className="size-4" />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </SheetPortal>
    )
  },
)
SheetContent.displayName = DialogPrimitive.Content.displayName

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex shrink-0 flex-col gap-1 border-b border-border p-4 pr-12', className)}
      {...props}
    />
  )
}
function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('mt-auto flex shrink-0 justify-end gap-2 border-t border-border p-4', className)}
      {...props}
    />
  )
}
function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('font-semibold', className)} {...props} />
}
function SheetDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-xs text-muted-foreground', className)} {...props} />
}
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}

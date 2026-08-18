import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { gsap, motionDurations, motionEases, useGSAP, useReducedMotion } from '@/motion'
import { buttonVariants } from './button-variants'

interface DialogMotionContextValue {
  open: boolean
  present: boolean
  completeExit(): void
}

const DialogMotionContext = React.createContext<DialogMotionContextValue | null>(null)

type DialogProps = React.ComponentProps<typeof DialogPrimitive.Root>

function Dialog({ open: controlledOpen, defaultOpen, onOpenChange, children, ...props }: DialogProps) {
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
    <DialogMotionContext.Provider value={motionState}>
      <DialogPrimitive.Root {...props} open={open} onOpenChange={handleOpenChange}>
        {children}
      </DialogPrimitive.Root>
    </DialogMotionContext.Provider>
  )
}

const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close
const DialogPortal = DialogPrimitive.Portal

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-dialog-motion-overlay=""
    className={cn('fixed inset-0 z-[80] bg-black/40', className)}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

type DialogContentProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  'forceMount'
> & {
  showCloseButton?: boolean
}

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, showCloseButton = true, ...props }, forwardedRef) => {
  const motionState = React.useContext(DialogMotionContext)
  if (!motionState) throw new Error('DialogContent must be used within Dialog')

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
            autoAlpha: 0,
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
              autoAlpha: 0,
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
    <DialogPortal forceMount>
      <DialogOverlay ref={overlayRef} forceMount />
      <DialogPrimitive.Content
        ref={setContentRef}
        forceMount
        data-dialog-motion-content=""
        className={cn(
          'fixed left-1/2 top-1/2 z-[81] grid max-h-[calc(100dvh-48px)] w-[min(960px,calc(100vw-36px))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-visible border-0 bg-transparent p-0 text-popover-foreground shadow-none outline-none',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
              'absolute right-4 top-4 size-6 text-muted-foreground',
            )}
          >
            <X className="size-4" />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />
}
function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex justify-end gap-2', className)} {...props} />
}
function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-lg font-semibold', className)} {...props} />
}
function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
}
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}

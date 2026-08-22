import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const toastVariants = cva(
  [
    'group pointer-events-auto relative flex w-full items-center overflow-hidden rounded-full border',
    'bg-background px-5 py-3.5 text-foreground shadow-lg',
    'opacity-100 transition-[opacity,transform] duration-[var(--motion-duration-base)]',
    'data-[state=closed]:translate-x-4 data-[state=closed]:opacity-0',
    'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
    'data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]',
    'data-[swipe=cancel]:transition-transform data-[swipe=end]:opacity-0',
    'motion-reduce:transition-none',
  ],
  {
    variants: {
      tone: {
        info: 'border-[color-mix(in_srgb,var(--flux-accent)_38%,var(--flux-panel-border)_12%)]',
        warning: 'border-[color-mix(in_srgb,#f0b84b_55%,var(--flux-panel-border)_12%)]',
        error: 'border-[color-mix(in_srgb,var(--flux-danger)_58%,var(--flux-panel-border)_12%)]',
      },
    },
    defaultVariants: { tone: 'info' },
  },
)

const ToastProvider = ToastPrimitive.Provider

const ToastViewportPrimitive = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      'fixed right-4 bottom-[96px] z-[140] flex max-h-[calc(100vh-120px)] w-[min(390px,calc(100vw-32px))] flex-col gap-2.5 outline-none',
      className,
    )}
    {...props}
  />
))
ToastViewportPrimitive.displayName = ToastPrimitive.Viewport.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> &
  VariantProps<typeof toastVariants>

const Toast = React.forwardRef<React.ComponentRef<typeof ToastPrimitive.Root>, ToastProps>(
  ({ className, tone, ...props }, ref) => (
    <ToastPrimitive.Root
      ref={ref}
      className={cn(toastVariants({ tone }), className)}
      data-slot="toast"
      {...props}
    />
  ),
)
Toast.displayName = ToastPrimitive.Root.displayName

const ToastTitle = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn('text-[12px] font-semibold leading-5', className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitive.Title.displayName

const ToastDescription = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn('break-words text-[11px] leading-[1.45] text-muted-foreground', className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitive.Description.displayName

export { Toast, ToastDescription, ToastProvider, ToastTitle, ToastViewportPrimitive, toastVariants }

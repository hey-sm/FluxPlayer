import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
const alertVariants = cva('relative w-full rounded-lg border p-3 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-card text-foreground',
      destructive: 'border-destructive/45 bg-destructive/10 text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})
function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}
function AlertTitle({ className, ...props }: React.ComponentProps<'h5'>) {
  return <h5 className={cn('mb-1 font-medium', className)} {...props} />
}
function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-sm text-muted-foreground', className)} {...props} />
}
export { Alert, AlertTitle, AlertDescription }

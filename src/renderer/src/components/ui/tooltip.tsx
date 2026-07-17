import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger
function TooltipContent({
  className,
  sideOffset = 7,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-[100] rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-xl',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

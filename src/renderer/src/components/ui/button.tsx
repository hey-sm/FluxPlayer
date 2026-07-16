import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:pointer-events-none [&_svg]:size-4",
  { variants: {
    variant: {
      default: "bg-primary text-primary-foreground hover:brightness-110",
      destructive: "bg-destructive text-white hover:brightness-110",
      outline: "border border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
      secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
      ghost: "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
      glass: "border border-border bg-card/70 text-foreground backdrop-blur-xl hover:bg-accent",
      link: "text-primary underline-offset-4 hover:underline",
    },
    size: { default: "h-9 px-4 py-2", sm: "h-8 rounded-md px-3 text-xs", lg: "h-10 rounded-md px-6", icon: "size-9", "icon-sm": "size-8" },
  }, defaultVariants: { variant: "default", size: "default" } },
)

function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}
export { Button, buttonVariants }

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/lib/utils"
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) { return <TabsPrimitive.Root className={cn("flex flex-col gap-2", className)} {...props} /> }
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) { return <TabsPrimitive.List className={cn("inline-flex h-9 items-center rounded-lg border border-border bg-muted p-1", className)} {...props} /> }
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) { return <TabsPrimitive.Trigger className={cn("inline-flex h-7 flex-1 items-center justify-center rounded-md px-3 text-xs text-muted-foreground outline-none transition data-[state=active]:bg-accent data-[state=active]:text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)} {...props} /> }
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) { return <TabsPrimitive.Content className={cn("outline-none", className)} {...props} /> }
export { Tabs, TabsList, TabsTrigger, TabsContent }

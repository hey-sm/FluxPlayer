import { HoverEdgeSheet } from './HoverEdgeSheet'

export function LibrarySheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <HoverEdgeSheet side="left" open={open} onOpenChange={onOpenChange}>
      {children}
    </HoverEdgeSheet>
  )
}

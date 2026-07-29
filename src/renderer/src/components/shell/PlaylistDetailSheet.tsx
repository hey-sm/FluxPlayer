import { HoverEdgeSheet } from './HoverEdgeSheet'

export function PlaylistDetailSheet({
  open,
  available,
  onOpenChange,
  children,
}: {
  open: boolean
  available: boolean
  onOpenChange(open: boolean): void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <HoverEdgeSheet side="right" open={open} available={available} onOpenChange={onOpenChange}>
      {children}
    </HoverEdgeSheet>
  )
}

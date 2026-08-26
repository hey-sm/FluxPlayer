import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function SettingsDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[min(680px,calc(100dvh-40px))] max-h-none w-[min(720px,calc(100vw-36px))] grid-rows-[minmax(0,1fr)] gap-0 overflow-visible rounded-[var(--flux-radius-shell)] border-0 bg-transparent p-0 shadow-none [&>button:last-child]:top-3 [&>button:last-child]:right-3 [&>button:last-child]:z-10 [&>button:last-child]:size-8 [&>button:last-child]:rounded-[var(--flux-radius-control)] [&>button:last-child]:border-0 [&>button:last-child]:bg-transparent [&>button:last-child]:text-[var(--flux-text-muted)] [&>button:last-child:hover]:bg-[color-mix(in_srgb,var(--flux-panel-border)_10%,transparent)] [&>button:last-child:hover]:text-[var(--flux-text)] [&>button:last-child]:[&_svg]:size-4"
        data-settings-dialog=""
      >
        <DialogHeader className="sr-only">
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>FluxPlayer 播放器设置</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

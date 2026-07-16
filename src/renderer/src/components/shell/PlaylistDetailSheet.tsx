import { useRef } from 'react'

export function PlaylistDetailSheet({ open, available, onOpenChange, children }: {
  open: boolean
  available: boolean
  onOpenChange(open: boolean): void
  children: React.ReactNode
}): React.JSX.Element {
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClose = (): void => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null }
  const scheduleClose = (): void => { cancelClose(); closeTimer.current = setTimeout(() => onOpenChange(false), 2000) }
  return <>
    <div className="flux-detail-sensor" aria-hidden="true" onPointerEnter={() => { cancelClose(); if (available) onOpenChange(true) }} />
    <div className={`flux-detail-sheet flux-hover-panel${open ? ' is-open' : ''}`} onPointerEnter={cancelClose} onPointerLeave={scheduleClose}>
      <div className="flux-sheet-body">{children}</div>
    </div>
  </>
}

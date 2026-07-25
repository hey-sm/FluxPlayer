import { useRef } from 'react'
import { AnimatedContent } from '../react-bits/AnimatedContent'

export function LibrarySheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  children: React.ReactNode
}): React.JSX.Element {
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClose = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const scheduleClose = (): void => {
    cancelClose()
    closeTimer.current = setTimeout(() => onOpenChange(false), 2000)
  }

  return (
    <>
      <div
        className="flux-library-sensor"
        aria-hidden="true"
        onPointerEnter={() => {
          cancelClose()
          onOpenChange(true)
        }}
      />
      <AnimatedContent
        visible={open}
        direction="horizontal"
        reverse
        className="flux-library-sheet flux-hover-panel"
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
      >
        <div className="flux-sheet-body">{children}</div>
      </AnimatedContent>
    </>
  )
}

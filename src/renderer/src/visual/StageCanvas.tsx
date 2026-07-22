import { useEffect, useRef } from 'react'
import type { VisualPreset } from './bus'
import type { VisualStage } from './stage'

export interface LyricsOffset {
  x: number
  y: number
}

export interface StageCanvasProps {
  preset?: VisualPreset
  backgroundEnabled?: boolean
  lyricsDragEnabled?: boolean
  lyricsOffset?: LyricsOffset
  onLyricsOffsetChange?(offset: LyricsOffset): void
  className?: string
  style?: React.CSSProperties
}

function isProtectedUiTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('button, input, select, textarea, a, [role="button"], [role="dialog"]'))
  )
}

export function StageCanvas({
  preset = 2,
  backgroundEnabled = true,
  lyricsDragEnabled = false,
  lyricsOffset = { x: 0, y: 0 },
  onLyricsOffsetChange,
  className,
  style,
}: StageCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<VisualStage | null>(null)
  const presetRef = useRef(preset)
  const backgroundEnabledRef = useRef(backgroundEnabled)
  const lyricsDragEnabledRef = useRef(lyricsDragEnabled)
  const lyricsOffsetRef = useRef(lyricsOffset)
  const onLyricsOffsetChangeRef = useRef(onLyricsOffsetChange)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let cleanup: (() => void) | undefined

    void import('./stage').then(({ VisualStage: Stage }) => {
      if (disposed) return
      const stage = new Stage()
      stageRef.current = stage
      stage.mount(container)
      stage.setPreset(presetRef.current)
      stage.setBackgroundEnabled(backgroundEnabledRef.current)
      stage.setLyricsDragEnabled(lyricsDragEnabledRef.current)
      stage.setLyricsOffset(lyricsOffsetRef.current.x, lyricsOffsetRef.current.y)
      const stop = stage.start()
      let pointerId: number | null = null
      let interactionMode: 'move' | 'rotate' | null = null
      let dragging = false
      let startX = 0
      let startY = 0
      let lastX = 0
      let lastY = 0

      const isLyricsRegion = (x: number, y: number): boolean => {
        const rect = container.getBoundingClientRect()
        return (
          x >= rect.left + rect.width * 0.16 &&
          x <= rect.right - rect.width * 0.16 &&
          y >= rect.top + rect.height * 0.22 &&
          y <= rect.bottom - rect.height * 0.22
        )
      }

      const stopDragging = (): void => {
        if (pointerId === null) return
        pointerId = null
        if (dragging && interactionMode === 'move') {
          onLyricsOffsetChangeRef.current?.(stage.getLyricsOffset())
        }
        if (interactionMode === 'rotate') stage.stopLyricsRotation()
        interactionMode = null
        dragging = false
        document.documentElement.removeAttribute('data-pointer-dragging')
      }
      const onPointerDown = (event: PointerEvent): void => {
        if (
          event.button !== 0 ||
          isProtectedUiTarget(event.target) ||
          !isLyricsRegion(event.clientX, event.clientY)
        )
          return
        pointerId = event.pointerId
        interactionMode = lyricsDragEnabledRef.current ? 'move' : 'rotate'
        startX = lastX = event.clientX
        startY = lastY = event.clientY
      }
      const onPointerMove = (event: PointerEvent): void => {
        if (pointerId !== event.pointerId) return
        if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) >= 3) {
          dragging = true
          document.documentElement.setAttribute('data-pointer-dragging', '')
          container.setPointerCapture?.(event.pointerId)
        }
        if (!dragging) return
        const dx = event.clientX - lastX
        const dy = event.clientY - lastY
        if (interactionMode === 'move') stage.moveLyricsBy(dx, dy)
        else stage.rotateLyricsBy(dx, dy)
        lastX = event.clientX
        lastY = event.clientY
        event.preventDefault()
      }
      const onPointerUp = (event: PointerEvent): void => {
        if (pointerId !== event.pointerId) return
        if (container.hasPointerCapture?.(event.pointerId)) container.releasePointerCapture(event.pointerId)
        stopDragging()
      }
      const onVisibilityChange = (): void => {
        if (document.hidden) stopDragging()
      }
      const onWheel = (event: WheelEvent): void => {
        if (
          isProtectedUiTarget(event.target) ||
          !isLyricsRegion(event.clientX, event.clientY) ||
          (event.target instanceof Element && event.target.closest('[data-scroll-region]'))
        )
          return
        const delta =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? event.deltaY * 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? event.deltaY * innerHeight
              : event.deltaY
        stage.zoomLyrics(Math.max(-160, Math.min(160, delta)))
        event.preventDefault()
      }
      window.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false })
      window.addEventListener('pointerup', onPointerUp, true)
      window.addEventListener('pointercancel', onPointerUp, true)
      document.addEventListener('visibilitychange', onVisibilityChange)
      window.addEventListener('wheel', onWheel, { capture: true, passive: false })
      window.addEventListener('blur', stopDragging)

      cleanup = () => {
        window.removeEventListener('pointerdown', onPointerDown, true)
        window.removeEventListener('pointermove', onPointerMove, true)
        window.removeEventListener('pointerup', onPointerUp, true)
        window.removeEventListener('pointercancel', onPointerUp, true)
        document.removeEventListener('visibilitychange', onVisibilityChange)
        window.removeEventListener('wheel', onWheel, true)
        window.removeEventListener('blur', stopDragging)
        stop()
        stage.dispose()
        if (stageRef.current === stage) stageRef.current = null
      }
      if (disposed) cleanup()
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    presetRef.current = preset
    stageRef.current?.setPreset(preset)
  }, [preset])

  useEffect(() => {
    backgroundEnabledRef.current = backgroundEnabled
    stageRef.current?.setBackgroundEnabled(backgroundEnabled)
  }, [backgroundEnabled])

  useEffect(() => {
    lyricsDragEnabledRef.current = lyricsDragEnabled
    stageRef.current?.setLyricsDragEnabled(lyricsDragEnabled)
  }, [lyricsDragEnabled])

  useEffect(() => {
    lyricsOffsetRef.current = lyricsOffset
    stageRef.current?.setLyricsOffset(lyricsOffset.x, lyricsOffset.y)
  }, [lyricsOffset])

  useEffect(() => {
    onLyricsOffsetChangeRef.current = onLyricsOffsetChange
  }, [onLyricsOffsetChange])

  return (
    <div
      ref={containerRef}
      className={className}
      data-lyrics-draggable={lyricsDragEnabled || undefined}
      data-lyrics-interaction={lyricsDragEnabled ? 'move' : 'rotate'}
      style={{ width: '100%', height: '100%', ...style }}
    />
  )
}

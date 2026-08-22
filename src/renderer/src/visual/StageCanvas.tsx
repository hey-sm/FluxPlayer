import { useEffect, useRef } from 'react'
import { useThemeStore } from '../theme'
import type { DynamicBackgroundEffect } from './backgrounds/dynamic'
import type { LyricsAnimationMode } from './lyrics3d-mesh/animation'
import { VisualStage } from './stage'

export interface LyricsOffset {
  x: number
  y: number
}

export interface StageCanvasProps {
  backgroundEffect?: DynamicBackgroundEffect
  backgroundEnabled?: boolean
  lyricsAnimationMode?: LyricsAnimationMode
  lyricsFocusOnly?: boolean
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
  backgroundEffect = 'rain',
  backgroundEnabled = true,
  lyricsAnimationMode = 'compact',
  lyricsFocusOnly = false,
  lyricsOffset = { x: 0, y: 0 },
  onLyricsOffsetChange,
  className,
  style,
}: StageCanvasProps): React.JSX.Element {
  const accentColor = useThemeStore((state) => state.visualParams.accent)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<VisualStage | null>(null)
  const backgroundEffectRef = useRef(backgroundEffect)
  const backgroundEnabledRef = useRef(backgroundEnabled)
  const accentColorRef = useRef(accentColor)
  const lyricsAnimationModeRef = useRef(lyricsAnimationMode)
  const lyricsFocusOnlyRef = useRef(lyricsFocusOnly)
  const lyricsOffsetRef = useRef(lyricsOffset)
  const onLyricsOffsetChangeRef = useRef(onLyricsOffsetChange)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
      const stage = new VisualStage()
      stageRef.current = stage
      stage.setAccentColor(accentColorRef.current)
      stage.mount(container)
      stage.setBackgroundEffect(backgroundEffectRef.current)
      stage.setBackgroundEnabled(backgroundEnabledRef.current)
      stage.setLyricsAnimationMode(lyricsAnimationModeRef.current)
      stage.setLyricsFocusOnly(lyricsFocusOnlyRef.current)
      stage.setLyricsOffset(lyricsOffsetRef.current.x, lyricsOffsetRef.current.y)
      const stop = stage.start()
      let pointerId: number | null = null
      let backgroundPointerId: number | null = null
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
        if (isProtectedUiTarget(event.target)) return
        // 左键长按滑动 → 旋转视角；右键长按滑动 → 拖拽歌词位置。
        // 左键优先让背景交互接管（html-light 仅响应左键中心区域），右键留给拖拽。
        if (event.button === 0) {
          if (
            stage.beginBackgroundPointer(
              event.clientX,
              event.clientY,
              event.button,
              event.pointerId,
            )
          ) {
            backgroundPointerId = event.pointerId
            event.preventDefault()
            return
          }
        }
        if (!isLyricsRegion(event.clientX, event.clientY)) return
        if (event.button === 0) interactionMode = 'rotate'
        else if (event.button === 2) interactionMode = 'move'
        else return
        pointerId = event.pointerId
        startX = lastX = event.clientX
        startY = lastY = event.clientY
        if (event.button === 2) event.preventDefault()
      }
      const onPointerMove = (event: PointerEvent): void => {
        stage.setPointer(event.clientX, event.clientY, true)
        if (backgroundPointerId === event.pointerId) {
          stage.moveBackgroundPointer(event.clientX, event.clientY, event.button, event.pointerId)
          event.preventDefault()
          return
        }
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
        if (backgroundPointerId === event.pointerId) {
          stage.endBackgroundPointer(
            event.clientX,
            event.clientY,
            event.button,
            event.pointerId,
            event.type === 'pointercancel',
          )
          backgroundPointerId = null
          if (container.hasPointerCapture?.(event.pointerId)) {
            container.releasePointerCapture(event.pointerId)
          }
          return
        }
        if (pointerId !== event.pointerId) return
        if (container.hasPointerCapture?.(event.pointerId)) container.releasePointerCapture(event.pointerId)
        stopDragging()
      }
      const onVisibilityChange = (): void => {
        if (document.hidden) {
          if (backgroundPointerId !== null) {
            stage.endBackgroundPointer(0, 0, 0, backgroundPointerId, true)
            backgroundPointerId = null
          }
          stage.setPointer(0, 0, false)
          stopDragging()
        }
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
      const onContextMenu = (event: MouseEvent): void => {
        if (isProtectedUiTarget(event.target)) return
        if (!isLyricsRegion(event.clientX, event.clientY)) return
        event.preventDefault()
      }
      window.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false })
      window.addEventListener('pointerup', onPointerUp, true)
      window.addEventListener('pointercancel', onPointerUp, true)
      window.addEventListener('contextmenu', onContextMenu, true)
      document.addEventListener('visibilitychange', onVisibilityChange)
      window.addEventListener('wheel', onWheel, { capture: true, passive: false })
      const onBlur = (): void => {
        if (backgroundPointerId !== null) {
          stage.endBackgroundPointer(0, 0, 0, backgroundPointerId, true)
          backgroundPointerId = null
        }
        stage.setPointer(0, 0, false)
        stopDragging()
      }
      window.addEventListener('blur', onBlur)

      return () => {
        window.removeEventListener('pointerdown', onPointerDown, true)
        window.removeEventListener('pointermove', onPointerMove, true)
        window.removeEventListener('pointerup', onPointerUp, true)
        window.removeEventListener('pointercancel', onPointerUp, true)
        window.removeEventListener('contextmenu', onContextMenu, true)
        document.removeEventListener('visibilitychange', onVisibilityChange)
        window.removeEventListener('wheel', onWheel, true)
        window.removeEventListener('blur', onBlur)
        stop()
        stage.dispose()
        if (stageRef.current === stage) stageRef.current = null
      }
  }, [])

  useEffect(() => {
    backgroundEffectRef.current = backgroundEffect
    stageRef.current?.setBackgroundEffect(backgroundEffect)
  }, [backgroundEffect])

  useEffect(() => {
    backgroundEnabledRef.current = backgroundEnabled
    stageRef.current?.setBackgroundEnabled(backgroundEnabled)
  }, [backgroundEnabled])

  useEffect(() => {
    accentColorRef.current = accentColor
    stageRef.current?.setAccentColor(accentColor)
  }, [accentColor])

  useEffect(() => {
    lyricsAnimationModeRef.current = lyricsAnimationMode
    stageRef.current?.setLyricsAnimationMode(lyricsAnimationMode)
  }, [lyricsAnimationMode])

  useEffect(() => {
    lyricsFocusOnlyRef.current = lyricsFocusOnly
    stageRef.current?.setLyricsFocusOnly(lyricsFocusOnly)
  }, [lyricsFocusOnly])

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
      data-stage-background=""
      data-lyrics-draggable=""
      data-lyrics-interaction="dual"
      data-lyrics-animation-mode={lyricsAnimationMode}
      data-lyrics-focus-only={lyricsFocusOnly || undefined}
      style={{ width: '100%', height: '100%', ...style }}
    />
  )
}

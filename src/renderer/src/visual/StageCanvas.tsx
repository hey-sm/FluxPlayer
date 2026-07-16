// ============================================================
//  StageCanvas —— React 挂载点
//   视觉时钟由统一 Ticker 驱动；DOM 输入只在真实 shelf 卡片或左侧歌单架滚动区命中时接管。
// ============================================================
import { useEffect, useRef } from 'react'
import type { VisualPreset } from './bus'
import { VisualStage } from './stage'

export interface StageCanvasProps {
  /** 初始预设（0..5）。默认 2（ORBIT）。变化时热切换。 */
  preset?: VisualPreset
  /** 是否启用粒子、Bloom、封面和舞台交互；3D 歌词始终保留。 */
  backgroundEnabled?: boolean
  /** 容器附加类名（尺寸由容器决定，引擎按 100% 填充） */
  className?: string
  /** 容器内联样式 */
  style?: React.CSSProperties
}

function isProtectedUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button, input, select, textarea, a, [role="button"], [role="dialog"]'))
}

/**
 * 视觉舞台画布。容器负责尺寸；引擎按容器 100% 填充 canvas。
 * Stage 本身仍是 pointer-events:none；通过 window capture 做机械 raycast，未命中绝不阻断 UI。
 */
export function StageCanvas({
  preset = 2,
  backgroundEnabled = true,
  className,
  style
}: StageCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<VisualStage | null>(null)
  const backgroundEnabledRef = useRef(backgroundEnabled)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const stage = new VisualStage()
    stageRef.current = stage
    stage.mount(container)
    stage.setPreset(preset)
    stage.setBackgroundEnabled(backgroundEnabledRef.current)
    const stop = stage.start()

    let pointerId: number | null = null
    let dragTarget: 'lyrics' | 'background' | null = null
    let dragging = false
    let startX = 0
    let startY = 0
    let lastX = 0
    let lastY = 0
    const isLyricsRegion = (x: number, y: number): boolean => {
      const rect = container.getBoundingClientRect()
      return x >= rect.left + rect.width * 0.18 && x <= rect.right - rect.width * 0.18 &&
        y >= rect.top + rect.height * 0.22 && y <= rect.bottom - rect.height * 0.22
    }
    const stopDragging = (): void => {
      if (pointerId === null) return
      pointerId = null
      dragging = false
      dragTarget === 'lyrics' ? stage.stopLyricsRotation() : stage.stopCoverRotation()
      dragTarget = null
      document.documentElement.removeAttribute('data-pointer-dragging')
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || isProtectedUiTarget(event.target)) return
      const lyrics = isLyricsRegion(event.clientX, event.clientY)
      if (!lyrics && !backgroundEnabledRef.current) return
      pointerId = event.pointerId
      dragTarget = lyrics ? 'lyrics' : 'background'
      startX = lastX = event.clientX
      startY = lastY = event.clientY
    }
    const onPointerMove = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId || !dragTarget) return
      if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) >= 3) {
        dragging = true
        document.documentElement.setAttribute('data-pointer-dragging', '')
        container.setPointerCapture?.(event.pointerId)
      }
      if (!dragging) return
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      dragTarget === 'lyrics' ? stage.rotateLyricsBy(dx, dy) : stage.rotateCoverBy(dx, dy)
      lastX = event.clientX
      lastY = event.clientY
      event.preventDefault()
    }
    const onPointerUp = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return
      if (container.hasPointerCapture?.(event.pointerId)) container.releasePointerCapture(event.pointerId)
      stopDragging()
    }
    const onWindowBlur = (): void => stopDragging()
    const onVisibilityChange = (): void => { if (document.hidden) stopDragging() }
    const onWheel = (event: WheelEvent): void => {
      if (isProtectedUiTarget(event.target) || event.target instanceof Element && event.target.closest('[data-scroll-region]')) return
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * innerHeight : event.deltaY
      const bounded = Math.max(-160, Math.min(160, delta))
      if (isLyricsRegion(event.clientX, event.clientY)) stage.zoomLyrics(bounded)
      else if (backgroundEnabledRef.current) stage.zoomCover(bounded)
      else return
      event.preventDefault()
    }

    container.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false })
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    window.addEventListener('blur', onWindowBlur)

    return () => {
      container.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('blur', onWindowBlur)
      stop()
      stage.dispose()
      stageRef.current = null
    }
    // 仅在挂载/卸载时建/销引擎；preset 和回调通过独立 effect/ref 热更新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    stageRef.current?.setPreset(preset)
  }, [preset])

  useEffect(() => {
    backgroundEnabledRef.current = backgroundEnabled
    stageRef.current?.setBackgroundEnabled(backgroundEnabled)
  }, [backgroundEnabled])

  return <div ref={containerRef} className={className} style={{ width: '100%', height: '100%', ...style }} />
}

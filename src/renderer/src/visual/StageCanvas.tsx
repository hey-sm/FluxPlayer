// ============================================================
//  StageCanvas —— React 挂载点
//   视觉时钟由统一 Ticker 驱动；DOM 输入只在真实 shelf 卡片或左侧歌单架滚动区命中时接管。
// ============================================================
import { useEffect, useRef } from 'react'
import type { VisualPreset } from './bus'
import type { ShelfAction, ShelfViewportPointerInput } from './shelf'
import { VisualStage } from './stage'

export interface StageCanvasProps {
  /** 初始预设（0..5）。默认 2（ORBIT）。变化时热切换。 */
  preset?: VisualPreset
  /** 容器附加类名（尺寸由容器决定，引擎按 100% 填充） */
  className?: string
  /** 容器内联样式 */
  style?: React.CSSProperties
  /** 只派发被 shelf 消费的低频 center/select 动作。 */
  onShelfAction?(action: ShelfAction): void
}

function isProtectedUiTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      'button, input, select, textarea, a, [role="button"], [role="dialog"], .glass-surface, .flux-glass-surface, .flux-glass-card, .shelf-detail-panel, .library-edge, .detail-edge, .search-shell, .topbar, .playerbar',
    ),
  )
}

/**
 * 视觉舞台画布。容器负责尺寸；引擎按容器 100% 填充 canvas。
 * Stage 本身仍是 pointer-events:none；通过 window capture 做机械 raycast，未命中绝不阻断 UI。
 */
export function StageCanvas({
  preset = 2,
  className,
  style,
  onShelfAction,
}: StageCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<VisualStage | null>(null)
  const onShelfActionRef = useRef(onShelfAction)

  useEffect(() => {
    onShelfActionRef.current = onShelfAction
  }, [onShelfAction])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const stage = new VisualStage()
    stageRef.current = stage
    stage.mount(container)
    stage.setPreset(preset)
    const stop = stage.start()

    const pointerInput = (
      event: Pick<PointerEvent | WheelEvent, 'clientX' | 'clientY'>,
      phase: ShelfViewportPointerInput['phase'],
    ): ShelfViewportPointerInput => {
      const bounds = container.getBoundingClientRect()
      return {
        x: event.clientX,
        y: event.clientY,
        width: bounds.width,
        height: bounds.height,
        left: bounds.left,
        top: bounds.top,
        phase,
      }
    }
    const clearHover = (): void => {
      const bounds = container.getBoundingClientRect()
      stage.viewportShelfPointer({
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
        left: bounds.left,
        top: bounds.top,
        phase: 'leave',
      })
    }
    let mouseDown = false
    let dragging = false
    let startX = 0
    let startY = 0
    let lastX = 0
    let lastY = 0
    const stopDragging = (): void => {
      if (!mouseDown && !dragging) return
      mouseDown = false
      dragging = false
      stage.stopCoverRotation()
    }
    const onMouseMove = (event: MouseEvent): void => {
      if (mouseDown) {
        const dx = event.clientX - lastX
        const dy = event.clientY - lastY
        if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) >= 3) dragging = true
        if (dragging) stage.rotateCoverBy(dx, dy)
        lastX = event.clientX
        lastY = event.clientY
        return
      }
      if (isProtectedUiTarget(event.target)) { clearHover(); return }
      stage.viewportShelfPointer(pointerInput(event, 'move'))
    }
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0) return
      mouseDown = true
      dragging = false
      startX = lastX = event.clientX
      startY = lastY = event.clientY
    }
    const onMouseUp = (event: MouseEvent): void => {
      if (event.button === 0) stopDragging()
    }
    const onWindowBlur = (): void => {
      stopDragging()
      clearHover()
    }
    const onVisibilityChange = (): void => {
      if (document.hidden) stopDragging()
    }
    const onWheel = (event: WheelEvent): void => {
      if (isProtectedUiTarget(event.target)) return
      stage.zoomCover(event.deltaY)
      event.preventDefault()
    }

    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mouseup', onMouseUp, true)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    window.addEventListener('blur', onWindowBlur)

    return () => {
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mouseup', onMouseUp, true)
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

  return <div ref={containerRef} className={className} style={{ width: '100%', height: '100%', ...style }} />
}

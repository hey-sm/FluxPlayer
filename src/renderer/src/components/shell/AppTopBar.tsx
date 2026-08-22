import { useEffect, useMemo, useRef, useState } from 'react'
import { Focus, Maximize2, Minimize2, Minus, Settings, X } from 'lucide-react'
import type { DesktopWindowState } from '@shared/ipc-contract'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { gsap, motionDurations, motionEases, useGSAP, useReducedMotion } from '@/motion'
import { sortToasts, useToast } from '@/stores/toast'
import { isWindowFullscreen } from './window-state'

export type ActiveSheet = 'library' | 'detail' | null

interface AppTopBarProps {
  settingsOpen: boolean
  onToggleSettings(): void
  onEnterFocusMode(): void
}

function TopBarButton({
  label,
  active,
  className,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  className?: string
  disabled?: boolean
  onClick(): void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            'h-7 w-8 rounded-lg text-[var(--flux-text-muted)] [-webkit-app-region:no-drag]',
            'hover:bg-[color-mix(in_srgb,var(--flux-panel-border)_10%,transparent)] hover:text-[var(--flux-text)]',
            'aria-pressed:bg-[color-mix(in_srgb,var(--flux-panel-border)_10%,transparent)] aria-pressed:text-[var(--flux-text)]',
            className,
          )}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={(event) => {
            onClick()
            event.currentTarget.blur()
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Mirrors the main process window state so the fullscreen button can label its own next action. */
function useWindowFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    const apply = (state: DesktopWindowState): void => setFullscreen(isWindowFullscreen(state))
    void desktop
      .getWindowState()
      .then(apply)
      .catch(() => undefined)
    return desktop.onWindowState(apply)
  }, [])
  return fullscreen
}

/** 顶栏中央状态条：玻璃态容器，优先显示 toast 通知，无通知时显示当前播放歌曲。
 *  多条通知按优先级轮播，超长文案横向滚动。 */
function CenterStatus(): React.JSX.Element {
  const toastItems = useToast((s) => s.items)
  const dismiss = useToast((s) => s.dismiss)

  const sorted = useMemo(() => sortToasts(toastItems), [toastItems])
  const activeIndex = useRef(0)
  const [renderKey, setRenderKey] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const tweenRef = useRef<gsap.core.Tween | null>(null)
  const reducedMotion = useReducedMotion()

  const hasNotice = sorted.length > 0
  const active = hasNotice ? sorted[Math.min(activeIndex.current, sorted.length - 1)] : null

  // 通知列表变化时重置到第一条
  useEffect(() => {
    activeIndex.current = 0
    setRenderKey((k) => k + 1)
  }, [sorted.length])

  // 多条通知轮播（每 4 秒切下一条）
  useEffect(() => {
    if (sorted.length <= 1) return
    const timer = setInterval(() => {
      activeIndex.current = (activeIndex.current + 1) % sorted.length
      setRenderKey((k) => k + 1)
    }, 4000)
    return () => clearInterval(timer)
  }, [sorted.length])

  // 超长文案横向滚动
  useEffect(() => {
    const container = containerRef.current
    const textEl = textRef.current
    if (!container || !textEl) return

    tweenRef.current?.kill()
    tweenRef.current = null

    const overflow = textEl.scrollWidth - container.clientWidth + 16
    if (overflow > 4 && !reducedMotion) {
      const distance = overflow + 24
      tweenRef.current = gsap.to(textEl, {
        x: -distance,
        duration: Math.max(3, distance / 40),
        ease: 'none',
        repeat: -1,
        repeatDelay: 0.8,
        onRepeat: () => gsap.set(textEl, { x: 0 }),
      })
    } else {
      gsap.set(textEl, { x: 0 })
    }

    return () => {
      tweenRef.current?.kill()
      tweenRef.current = null
    }
  }, [renderKey, reducedMotion])

  const toneColor =
    active?.tone === 'error'
      ? 'text-[var(--flux-danger)]'
      : active?.tone === 'warning'
        ? 'text-[#f0b84b]'
        : 'text-[var(--flux-text)]'

  // 无通知时不渲染任何内容（仅保留 flex-1 占位让左右两端自然分布）
  if (!hasNotice) {
    return <div className="flex-1" aria-hidden="true" />
  }

  return (
    <div className="relative mx-auto flex min-w-0 flex-1 items-center justify-center [-webkit-app-region:no-drag]">
      {hasNotice && active ? (
        <div
          ref={containerRef}
          className={cn(
            'flex h-7 max-w-[340px] min-w-[120px] items-center gap-1.5 overflow-hidden rounded-full px-2.5',
            'border bg-[color-mix(in_srgb,var(--flux-panel-surface)_55%,transparent)]',
            '[backdrop-filter:blur(var(--flux-glass-blur))] [box-shadow:var(--flux-shadow-raised)]',
            'transition-[border-color] duration-200',
            active.tone === 'error'
              ? 'border-[color-mix(in_srgb,var(--flux-danger)_35%,transparent)]'
              : active.tone === 'warning'
                ? 'border-[color-mix(in_srgb,#f0b84b_30%,transparent)]'
                : 'border-[color-mix(in_srgb,var(--flux-accent)_25%,transparent)]',
          )}
        >
          <button
            type="button"
            className="flex min-w-0 items-center gap-1.5"
            onClick={() => dismiss(active.id)}
            aria-label="关闭通知"
          >
            {active.title ? (
              <span ref={labelRef} className={cn('shrink-0 text-[10px] font-semibold leading-7', toneColor)}>
                {active.title}
              </span>
            ) : null}
            <span
              ref={textRef}
              className={cn(
                'inline-block min-w-0 whitespace-nowrap text-[11px] font-medium leading-7',
                toneColor,
              )}
            >
              {active.message}
            </span>
          </button>
        </div>
      ) : null}
      {sorted.length > 1 ? (
        <span className="ml-1.5 flex shrink-0 items-center gap-1">
          {sorted.map((item, i) => (
            <span
              key={item.id}
              className={cn(
                'h-1 w-1 rounded-full transition-opacity',
                i === activeIndex.current % sorted.length
                  ? 'bg-[var(--flux-text)] opacity-100'
                  : 'bg-[var(--flux-text-muted)] opacity-40',
              )}
            />
          ))}
        </span>
      ) : null}
    </div>
  )
}

export function AppTopBar({
  settingsOpen,
  onToggleSettings,
  onEnterFocusMode,
}: AppTopBarProps): React.JSX.Element {
  const desktop = window.fluxDesktop
  const fullscreen = useWindowFullscreen()
  return (
    <TooltipProvider delayDuration={350} disableHoverableContent>
      <header
        data-app-chrome="topbar"
        className="relative z-[70] flex h-[var(--flux-topbar-height)] flex-[0_0_var(--flux-topbar-height)] select-none items-center gap-3 bg-transparent py-0 pr-2.5 pl-4 [-webkit-app-region:drag]"
      >
        <div className="flex items-center gap-[9px]" aria-label="FluxPlayer">
          <img className="block size-5 rounded-[5px]" src="/favicon.svg" alt="" />
          <span className="text-[13px] font-semibold tracking-[0.14em]">FLUXP</span>
        </div>
        <CenterStatus />
        <nav className="flex items-center gap-0.5 [-webkit-app-region:no-drag]" aria-label="窗口与面板控制">
          <TopBarButton label="设置" active={settingsOpen} onClick={onToggleSettings}>
            <Settings />
          </TopBarButton>
          <TopBarButton label="沉浸全屏" onClick={onEnterFocusMode}>
            <Focus />
          </TopBarButton>
          {desktop ? (
            <>
              <TopBarButton label="最小化" onClick={() => desktop.minimize()}>
                <Minus />
              </TopBarButton>
              <TopBarButton label={fullscreen ? '恢复' : '全屏'} onClick={() => desktop.toggleFullscreen()}>
                {fullscreen ? <Minimize2 /> : <Maximize2 />}
              </TopBarButton>
              <TopBarButton
                label="关闭"
                className="hover:bg-[var(--flux-danger)] hover:text-white"
                onClick={() => desktop.close()}
              >
                <X />
              </TopBarButton>
            </>
          ) : null}
        </nav>
      </header>
    </TooltipProvider>
  )
}

function FocusExitZone({ side, onExit }: { side: 'left' | 'right'; onExit(): void }): React.JSX.Element {
  const zoneRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const reducedMotion = useReducedMotion()
  const { contextSafe } = useGSAP(
    () => {
      gsap.set(buttonRef.current, { autoAlpha: 0, y: reducedMotion ? 0 : -8 })
    },
    { scope: zoneRef, dependencies: [reducedMotion], revertOnUpdate: true },
  )

  const setRevealed = contextSafe((revealed: boolean) => {
    gsap.to(buttonRef.current, {
      autoAlpha: revealed ? 1 : 0,
      y: revealed || reducedMotion ? 0 : -8,
      duration: reducedMotion ? 0 : motionDurations.base,
      ease: revealed ? motionEases.enter : motionEases.exit,
      overwrite: 'auto',
    })
  })

  return (
    <div
      ref={zoneRef}
      data-focus-exit-zone=""
      data-side={side}
      className={cn(
        'absolute top-0 flex h-[72px] w-[min(220px,28vw)] items-center px-4 py-2.5 [-webkit-app-region:no-drag] pointer-events-auto',
        side === 'left' ? 'left-0 justify-start' : 'right-0 justify-end',
      )}
      onPointerEnter={() => setRevealed(true)}
      onPointerLeave={() => setRevealed(false)}
      onFocusCapture={() => setRevealed(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setRevealed(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="grid size-11 translate-y-[-8px] place-items-center rounded-[var(--flux-radius-panel)] border border-[var(--flux-glass-border)] bg-[var(--flux-glass-background)] text-[var(--flux-text)] opacity-0 invisible [backdrop-filter:blur(var(--flux-glass-blur))] [box-shadow:var(--flux-shadow-float)] transition-colors hover:text-[var(--flux-accent-strong)] focus-visible:visible focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--flux-accent)] [&_svg]:size-5"
        aria-label="退出沉浸全屏"
        title="退出沉浸全屏 (Esc)"
        onClick={onExit}
      >
        <Minimize2 />
      </button>
    </div>
  )
}

export function FocusModeExitControls({ onExit }: { onExit(): void }): React.JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-0 z-[100]" aria-label="退出沉浸全屏">
      <FocusExitZone side="left" onExit={onExit} />
      <FocusExitZone side="right" onExit={onExit} />
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Focus, Maximize2, Minimize2, Minus, Settings, X } from 'lucide-react'
import type { DesktopWindowState } from '@shared/ipc-contract'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { gsap, motionDurations, motionEases, useGSAP, useReducedMotion } from '@/motion'
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
          onClick={onClick}
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

export function AppTopBar({
  settingsOpen,
  onToggleSettings,
  onEnterFocusMode,
}: AppTopBarProps): React.JSX.Element {
  const desktop = window.fluxDesktop
  const fullscreen = useWindowFullscreen()
  return (
    <TooltipProvider delayDuration={350}>
      <header
        data-app-chrome="topbar"
        className="relative z-[70] flex h-[var(--flux-topbar-height)] flex-[0_0_var(--flux-topbar-height)] select-none items-center gap-3 bg-transparent py-0 pr-2.5 pl-4 [-webkit-app-region:drag]"
      >
        <div className="flex items-center gap-[9px]" aria-label="FluxPlayer">
          <img className="block size-5 rounded-[5px]" src="/favicon.svg" alt="" />
          <span className="text-[13px] font-semibold tracking-[0.14em]">FLUXP</span>
        </div>
        <div className="flex-1" />
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

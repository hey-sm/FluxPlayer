import {
  Maximize2,
  Minus,
  Settings,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export type ActiveSheet = 'library' | 'detail' | null

interface AppTopBarProps {
  settingsOpen: boolean
  onToggleSettings(): void
}

function TopBarButton({ label, active, className, disabled, onClick, children }: {
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
          className={className}
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

export function AppTopBar({
  settingsOpen,
  onToggleSettings,
}: AppTopBarProps): React.JSX.Element {
  const desktop = window.fluxDesktop
  return (
    <TooltipProvider delayDuration={350}>
      <header className="topbar">
        <div className="topbar-brand" aria-label="FluxPlayer">
          <img className="brand-logo" src="/favicon.svg" alt="" />
          <span className="brand">FLUXP</span>
        </div>
        <div className="spacer" />
        <nav className="topbar-actions" aria-label="窗口与面板控制">
          <TopBarButton label="设置" active={settingsOpen} onClick={onToggleSettings}><Settings /></TopBarButton>
          {desktop ? <>
            <TopBarButton label="最小化" onClick={() => desktop.minimize()}><Minus /></TopBarButton>
            <TopBarButton label="全屏" onClick={() => desktop.toggleFullscreen()}><Maximize2 /></TopBarButton>
            <TopBarButton label="关闭" className="close" onClick={() => desktop.close()}><X /></TopBarButton>
          </> : null}
        </nav>
      </header>
    </TooltipProvider>
  )
}

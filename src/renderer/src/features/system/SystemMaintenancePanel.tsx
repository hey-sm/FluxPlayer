import { useCallback, useEffect, useRef, useState } from 'react'
import { cva } from 'class-variance-authority'
import type { UpdaterState, UpdaterStatus } from '@shared/updater-contract'
import { DEFAULT_UPDATER_STATE } from '@shared/updater-contract'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { gsap, motionDurations, motionEases, useGSAP, useReducedMotion } from '@/motion'
import { clampUpdaterProgress } from './progress'

type Command = 'check' | 'download' | 'install'
type Tone = 'neutral' | 'success' | 'warning' | 'danger'

const COPY: Record<UpdaterStatus, { label: string; detail: string; tone: Tone }> = {
  idle: { label: '等待检查', detail: '更新器已就绪，仅在你主动操作时联网。', tone: 'neutral' },
  checking: { label: '正在检查', detail: '正在核对可用版本。', tone: 'warning' },
  available: { label: '发现新版本', detail: '新版本可供下载。', tone: 'warning' },
  'not-available': { label: '已是最新', detail: '当前没有可用的新版本。', tone: 'success' },
  downloading: { label: '准备下载', detail: '正在建立下载任务。', tone: 'warning' },
  progress: { label: '正在下载', detail: '更新包正在下载。', tone: 'warning' },
  downloaded: { label: '等待安装', detail: '更新包已下载并完成校验。', tone: 'success' },
  error: { label: '更新失败', detail: '操作失败，可稍后重试。', tone: 'danger' },
}

const DISABLED = {
  development: '开发模式不执行应用更新。',
  smoke: '冒烟测试期间不执行应用更新。',
} as const

const statusVariants = cva(
  [
    'inline-flex min-h-[1.7rem] shrink-0 items-center gap-[0.42rem] whitespace-nowrap rounded-full border px-[0.58rem] py-1',
    'text-[0.68rem] font-semibold',
  ],
  {
    variants: {
      tone: {
        neutral: [
          'border-[color-mix(in_srgb,var(--flux-panel-border)_8%,transparent)]',
          'bg-[color-mix(in_srgb,var(--flux-panel-border)_4%,transparent)] text-[var(--flux-text-muted)]',
        ],
        success:
          'border-[color-mix(in_srgb,#6ed9ad_22%,transparent)] bg-[color-mix(in_srgb,#6ed9ad_7%,transparent)] text-[#86dfbd]',
        warning:
          'border-[color-mix(in_srgb,#efbf72_22%,transparent)] bg-[color-mix(in_srgb,#efbf72_7%,transparent)] text-[#e9c58b]',
        danger: [
          'border-[color-mix(in_srgb,var(--flux-danger)_25%,transparent)]',
          'bg-[color-mix(in_srgb,var(--flux-danger)_7%,transparent)]',
          'text-[color-mix(in_srgb,var(--flux-danger)_78%,white_22%)]',
        ],
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

function version(value: string | null): string {
  if (!value) return '—'
  return value.startsWith('v') ? value : `v${value}`
}

export function SystemMaintenancePanel({ className = '' }: { className?: string }) {
  const desktop = window.fluxDesktop
  const [state, setState] = useState<UpdaterState>({ ...DEFAULT_UPDATER_STATE })
  const [command, setCommand] = useState<Command | null>(null)
  const progressFillRef = useRef<HTMLSpanElement>(null)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (!desktop) return
    let active = true
    void desktop.getUpdaterState().then((next) => active && setState(next))
    const unsubscribe = desktop.onUpdaterState((next) => active && setState(next))
    return () => {
      active = false
      unsubscribe()
    }
  }, [desktop])

  const run = useCallback(
    async (next: Command) => {
      if (!desktop || command) return
      setCommand(next)
      try {
        const result =
          next === 'check'
            ? await desktop.checkForUpdates()
            : next === 'download'
              ? await desktop.downloadUpdate()
              : await desktop.installUpdate()
        setState(result.state)
      } finally {
        setCommand(null)
      }
    },
    [command, desktop],
  )

  const copy = COPY[state.status]
  const disabled = state.disabledReason ? DISABLED[state.disabledReason] : null
  const percent = clampUpdaterProgress(state.progress?.percent)
  const busy = command !== null || ['checking', 'downloading', 'progress'].includes(state.status)

  useGSAP(
    () => {
      gsap.to(progressFillRef.current, {
        scaleX: percent / 100,
        transformOrigin: 'left center',
        duration: reducedMotion ? 0 : motionDurations.base,
        ease: motionEases.standard,
        overwrite: 'auto',
      })
      return () => gsap.killTweensOf(progressFillRef.current)
    },
    { dependencies: [percent, reducedMotion] },
  )

  return (
    <section
      className={cn('w-full text-[var(--flux-text)] [font-family:var(--flux-font-family)]', className)}
      aria-label="应用更新"
      data-system-maintenance=""
    >
      <header className="mb-4 flex items-center justify-between gap-5 max-[560px]:block">
        <div className="min-w-0">
          <h2 className="text-sm leading-[1.3] font-semibold text-[var(--flux-text)]">应用更新</h2>
        </div>
        <p className="max-w-[25rem] text-right text-[0.7rem] leading-[1.5] text-[var(--flux-text-muted)] max-[560px]:mt-2 max-[560px]:text-left">
          更新不会改动个人音乐数据。
        </p>
      </header>
      <div className="grid grid-cols-1 gap-[0.9rem]">
        <div
          className="flex min-h-[16rem] min-w-0 flex-col gap-3.5 rounded-[var(--flux-glass-radius)] border border-[var(--flux-glass-border)] bg-[color-mix(in_srgb,var(--flux-glass-background)_55%,transparent)] p-4 max-[560px]:min-h-0"
          data-system-maintenance-card=""
        >
          <header className="flex items-center justify-between gap-4 max-[560px]:items-start">
            <div className="flex min-w-0 items-baseline gap-[0.62rem]">
              <span className="text-[0.62rem] font-[750] text-[color-mix(in_srgb,var(--flux-accent)_75%,white_25%)] tabular-nums">
                01
              </span>
              <h3 className="text-sm leading-[1.3] font-semibold text-[var(--flux-text)]">版本与更新</h3>
            </div>
            <span className={statusVariants({ tone: copy.tone })} data-tone={copy.tone}>
              <span className="size-[0.4rem] rounded-full bg-current shadow-[0_0_0.55rem_currentColor]" />
              {copy.label}
            </span>
          </header>
          <p className="text-[0.72rem] leading-[1.55] text-[var(--flux-text-muted)]">
            {disabled ?? copy.detail}
          </p>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-[0.55rem] max-[560px]:grid-cols-1">
            <div className="min-w-0 rounded-[calc(var(--flux-glass-radius)*0.7)] border border-[color-mix(in_srgb,var(--flux-panel-border)_6%,transparent)] bg-[color-mix(in_srgb,var(--flux-panel-surface)_58%,transparent)] px-[0.76rem] py-[0.7rem]">
              <dt className="mb-[0.3rem] text-[0.62rem] leading-[1.2] text-[var(--flux-text-muted)]">
                当前版本
              </dt>
              <dd className="min-w-0 text-[0.76rem] font-[570] text-[var(--flux-text)] tabular-nums">
                {version(state.currentVersion)}
              </dd>
            </div>
            <div className="min-w-0 rounded-[calc(var(--flux-glass-radius)*0.7)] border border-[color-mix(in_srgb,var(--flux-panel-border)_6%,transparent)] bg-[color-mix(in_srgb,var(--flux-panel-surface)_58%,transparent)] px-[0.76rem] py-[0.7rem]">
              <dt className="mb-[0.3rem] text-[0.62rem] leading-[1.2] text-[var(--flux-text-muted)]">
                可用版本
              </dt>
              <dd className="min-w-0 text-[0.76rem] font-[570] text-[var(--flux-text)] tabular-nums">
                {version(state.availableVersion)}
              </dd>
            </div>
          </dl>
          {state.progress ? (
            <div className="grid gap-[0.48rem]" data-system-maintenance-progress="">
              <div className="flex items-center justify-between gap-3 text-[0.66rem] text-[var(--flux-text-muted)] tabular-nums">
                <strong className="text-[0.7rem] font-[630] text-[var(--flux-text)]">下载进度</strong>
                <span>{percent.toFixed(1)}%</span>
              </div>
              <div
                className="h-[0.34rem] overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--flux-panel-border)_7%,transparent)]"
                role="progressbar"
                aria-label="更新下载进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span
                  ref={progressFillRef}
                  className="block h-full origin-left scale-x-0 rounded-[inherit] bg-[var(--flux-accent-strong)] shadow-[0_0_0.8rem_color-mix(in_srgb,var(--flux-accent)_34%,transparent)]"
                  data-system-maintenance-progress-fill=""
                />
              </div>
            </div>
          ) : null}
          {state.error ? (
            <div className="grid gap-1 rounded-[calc(var(--flux-glass-radius)*0.65)] border border-[color-mix(in_srgb,var(--flux-danger)_20%,transparent)] bg-[color-mix(in_srgb,var(--flux-danger)_5%,transparent)] px-[0.76rem] py-[0.68rem] text-[0.69rem] leading-[1.45] text-[color-mix(in_srgb,var(--flux-danger)_75%,white_25%)]">
              <strong className="text-[0.68rem] font-[650] text-[var(--flux-text)]">
                {state.error.code}
              </strong>
              <span>{state.error.message}</span>
            </div>
          ) : null}
          <footer className="mt-auto flex min-h-[2.1rem] flex-wrap items-center gap-2 pt-0.5 max-[560px]:[&>button]:flex-[1_1_calc(50%-0.5rem)]">
            <Button
              variant="glassRaised"
              size="action"
              disabled={Boolean(disabled) || busy}
              onClick={() => void run('check')}
            >
              {command === 'check' ? '检查中…' : '检查更新'}
            </Button>
            <Button
              variant="glassRaised"
              size="action"
              emphasis="primary"
              disabled={Boolean(disabled) || busy || state.status !== 'available'}
              onClick={() => void run('download')}
            >
              {command === 'download' ? '下载中…' : '下载更新'}
            </Button>
            <Button
              variant="glassRaised"
              size="action"
              emphasis="primary"
              disabled={Boolean(disabled) || busy || state.status !== 'downloaded'}
              onClick={() => void run('install')}
            >
              {command === 'install' ? '正在安装…' : '安装并重启'}
            </Button>
          </footer>
        </div>
      </div>
    </section>
  )
}

export default SystemMaintenancePanel

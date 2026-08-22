import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderId, QualityLevel } from '@shared/models'
import { cn } from '@/lib/utils'
import { gsap, motionDurations, motionEases, useGSAP, useReducedMotion } from '@/motion'
import { ticker } from '../../perf/ticker'
import { usePlaybackProgress, usePlayer } from '../../stores/player'
import { CLASSIC_GLASS_FILTER_SVG, useThemeStore } from '../../theme'
import { useClassicControlGlass } from '../glass/classic-control'
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon, RepeatIcon, RepeatOneIcon, ShuffleIcon } from '../Icons'
import { GlassSelect } from '../ui/glass-select'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

const QUALITY_LABELS: Readonly<Record<QualityLevel, string>> = {
  standard: '标准',
  exhigh: '极高',
  lossless: '无损',
  hires: 'Hi-Res',
  jymaster: '臻品',
}

const playerButtonClass = [
  'grid shrink-0 place-items-center rounded-full text-[var(--flux-text)] outline-none',
  'transition-[color,background-color,border-color,transform] duration-[var(--motion-duration-fast)]',
  'hover:not-disabled:-translate-y-px hover:not-disabled:text-[var(--flux-accent-strong)]',
  'active:translate-y-0 active:scale-95',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--flux-accent)]',
  'disabled:cursor-default disabled:opacity-35',
].join(' ')

function QualityMenu({
  provider,
  preference,
  resolved,
  supportedQualities,
  onChange,
}: {
  provider: ProviderId
  preference: QualityLevel
  resolved: QualityLevel | null
  supportedQualities?: readonly QualityLevel[]
  onChange(value: QualityLevel): Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const allOptions: readonly QualityLevel[] =
    provider === 'qq'
      ? ['hires', 'lossless', 'exhigh', 'standard']
      : ['jymaster', 'hires', 'lossless', 'exhigh', 'standard']
  // 按当前歌曲实际支持的音质过滤；无数据时回退到全量
  const options = useMemo(
    () =>
      supportedQualities && supportedQualities.length > 0
        ? allOptions.filter((q) => supportedQualities.includes(q))
        : allOptions,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [provider, supportedQualities],
  )
  const actual = resolved ?? preference
  // 下拉打开时自动滚动到「当前播放音质」而非「偏好音质」——用户体验最直观
  const selectValue = options.includes(actual) ? actual : preference
  // supportedQualities 变化时强制 GlassSelect 重新挂载，确保下拉列表项同步更新
  const qualityKey = (supportedQualities ?? []).join(',')

  return (
    <GlassSelect
      key={qualityKey}
      value={selectValue}
      ariaLabel="选择播放音质"
      title={`当前音质：${QUALITY_LABELS[actual]}`}
      disabled={busy}
      side="top"
      variant="compact"
      contentClassName="w-[136px] min-w-[136px]"
      options={options.map((quality) => ({
        value: quality,
        label: QUALITY_LABELS[quality],
        trailing: actual === quality ? '当前' : undefined,
      }))}
      renderValue={() => QUALITY_LABELS[actual]}
      onValueChange={(value) => {
        if (busy) return
        setBusy(true)
        void onChange(value as QualityLevel).finally(() => setBusy(false))
      }}
    />
  )
}

function PlayerProgress(): React.JSX.Element {
  const position = usePlaybackProgress((state) => state.position)
  const duration = usePlaybackProgress((state) => state.duration)
  const seek = usePlayer((state) => state.seek)
  const fillRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0

  useGSAP(
    () => {
      gsap.to(fillRef.current, {
        scaleX: ratio,
        duration: reducedMotion ? 0 : motionDurations.fast,
        ease: 'none',
        overwrite: 'auto',
      })
      return () => gsap.killTweensOf(fillRef.current)
    },
    { dependencies: [ratio, reducedMotion] },
  )

  return (
    <>
      <div
        data-player-progress=""
        className="relative h-1.5 flex-1 cursor-pointer rounded-[3px] bg-[color-mix(in_srgb,var(--flux-panel-border)_8%,transparent)]"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          seek((event.clientX - rect.left) / rect.width)
        }}
      >
        <div
          ref={fillRef}
          className="absolute inset-y-0 left-0 w-full origin-left scale-x-0 rounded-[3px] bg-[linear-gradient(90deg,var(--flux-accent),var(--flux-accent-strong))]"
        />
      </div>
      <span className="w-[86px] text-right text-[11px] text-[var(--flux-text-muted)] tabular-nums max-[820px]:hidden">
        {formatTime(position)} / {formatTime(duration)}
      </span>
    </>
  )
}

export function PlayerBar(): React.JSX.Element | null {
  const current = usePlayer((state) => state.current)
  const status = usePlayer((state) => state.status)
  const message = usePlayer((state) => state.message)
  const hasQueue = usePlayer((state) => state.queue.length > 0)
  const toggle = usePlayer((state) => state.toggle)
  const next = usePlayer((state) => state.next)
  const prev = usePlayer((state) => state.prev)
  const syncProgress = usePlayer((state) => state.syncProgress)
  const mode = usePlayer((state) => state.mode)
  const setMode = usePlayer((state) => state.setMode)
  const qualityPreference = usePlayer((state) => state.qualityPreference)
  const resolvedQuality = usePlayer((state) => state.resolvedQuality)
  const setQualityPreference = usePlayer((state) => state.setQualityPreference)
  const classicTheme = useThemeStore((state) => state.selectedPresetId === 'classic-gold')
  const controlGlassRef = useClassicControlGlass(classicTheme && Boolean(current))
  const reducedMotion = useReducedMotion()

  useEffect(() => ticker.add(() => syncProgress()), [syncProgress])

  useGSAP(
    () => {
      const element = controlGlassRef.current
      if (!element) return
      if (reducedMotion) {
        gsap.set(element, { autoAlpha: 1, y: 0 })
        return
      }
      gsap.fromTo(
        element,
        { autoAlpha: 0, y: 12 },
        {
          autoAlpha: 1,
          y: 0,
          duration: motionDurations.emphasized,
          ease: motionEases.enter,
          overwrite: 'auto',
        },
      )
      return () => gsap.killTweensOf(element)
    },
    {
      scope: controlGlassRef,
      dependencies: [current?.id, current?.provider, reducedMotion],
      revertOnUpdate: true,
    },
  )

  if (!current) return null
  const nextMode = mode === 'sequence' ? 'repeat-one' : mode === 'repeat-one' ? 'shuffle' : 'sequence'
  const modeLabel = mode === 'sequence' ? '列表循环' : mode === 'repeat-one' ? '单曲循环' : '随机播放'
  const playerMessage = status === 'loading' ? '取链中…' : message.startsWith('音质：') ? '' : message

  return (
    <div
      ref={controlGlassRef}
      data-playerbar=""
      className={cn(
        'playerbar relative mt-auto flex min-h-[70px] w-full max-w-[860px] self-center items-center gap-3.5 rounded-[var(--flux-radius-shell)] border border-[var(--flux-glass-border)] bg-[color-mix(in_srgb,var(--flux-glass-background)_88%,transparent)] px-4 py-3 [box-shadow:var(--flux-shadow-control)]',
        'max-[820px]:gap-2 max-[820px]:p-2.5',
        classicTheme && 'classic-control-glass',
      )}
    >
      {classicTheme ? (
        <svg className="control-glass-filter-svg" aria-hidden="true" focusable="false">
          <defs dangerouslySetInnerHTML={{ __html: CLASSIC_GLASS_FILTER_SVG }} />
        </svg>
      ) : null}
      <button
        className={cn(
          playerButtonClass,
          'size-8 border border-[var(--flux-glass-border)] bg-transparent hover:not-disabled:bg-[color-mix(in_srgb,var(--flux-panel-border)_8%,transparent)]',
        )}
        title="上一首"
        aria-label="上一首"
        disabled={!hasQueue}
        onClick={() => void prev()}
      >
        <PreviousIcon className="size-4" />
      </button>
      <button
        className={cn(
          playerButtonClass,
          'size-[42px] border border-[color-mix(in_srgb,var(--flux-accent)_50%,transparent)] bg-[color-mix(in_srgb,var(--flux-accent)_14%,transparent)]',
        )}
        aria-label={status === 'playing' ? '暂停' : '播放'}
        onClick={toggle}
      >
        {status === 'playing' ? <PauseIcon className="size-[18px]" /> : <PlayIcon className="size-[18px]" />}
      </button>
      <button
        className={cn(
          playerButtonClass,
          'size-8 border border-[var(--flux-glass-border)] bg-transparent hover:not-disabled:bg-[color-mix(in_srgb,var(--flux-panel-border)_8%,transparent)]',
        )}
        title="下一首"
        aria-label="下一首"
        disabled={!hasQueue}
        onClick={() => void next()}
      >
        <NextIcon className="size-4" />
      </button>
      <button
        className={cn(
          playerButtonClass,
          'size-[34px] border border-[color-mix(in_srgb,var(--flux-accent)_24%,transparent)] bg-[var(--flux-accent-soft)] px-0 text-[var(--flux-accent-strong)]',
        )}
        title={`播放模式：${modeLabel}（点击切换）`}
        aria-label={`播放模式：${modeLabel}`}
        onClick={() => setMode(nextMode)}
      >
        {mode === 'sequence' ? (
          <RepeatIcon className="size-4" />
        ) : mode === 'repeat-one' ? (
          <RepeatOneIcon className="size-4" />
        ) : (
          <ShuffleIcon className="size-4" />
        )}
      </button>
      <QualityMenu
        provider={current.provider}
        preference={qualityPreference}
        resolved={resolvedQuality}
        supportedQualities={current.supportedQualities}
        onChange={setQualityPreference}
      />
      <div
        data-player-info=""
        className="flex h-[34px] w-[220px] min-w-0 items-center gap-2 max-[820px]:w-[150px]"
      >
        <div className="min-w-0 truncate text-[13px] leading-[34px]">
          {current.name} — {current.artist}
        </div>
        {playerMessage || status === 'error' ? (
          <div
            className={cn(
              'flex min-w-0 flex-1 flex-nowrap items-center gap-2 truncate text-[11px] text-[var(--flux-text-muted)]',
              status === 'error' && 'text-[var(--flux-danger)]',
            )}
          >
            <span className="truncate">{playerMessage || '播放失败'}</span>
          </div>
        ) : null}
      </div>
      <PlayerProgress />
    </div>
  )
}

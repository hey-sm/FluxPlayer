import { useEffect, useState } from 'react'
import type { ProviderId, QualityLevel } from '@shared/models'
import { ticker } from '../../perf/ticker'
import { usePlaybackProgress, usePlayer } from '../../stores/player'
import { useThemeStore } from '../../theme'
import { CLASSIC_GLASS_FILTER_SVG } from '../../theme'
import { GlassSelect } from '../ui/glass-select'
import { useClassicControlGlass } from '../glass/classic-control'
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon, RepeatIcon, RepeatOneIcon, ShuffleIcon } from '../Icons'

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

function QualityMenu({
  provider,
  preference,
  resolved,
  onChange,
}: {
  provider: ProviderId
  preference: QualityLevel
  resolved: QualityLevel | null
  onChange(value: QualityLevel): Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const options: readonly QualityLevel[] =
    provider === 'qq'
      ? ['hires', 'lossless', 'exhigh', 'standard']
      : ['jymaster', 'hires', 'lossless', 'exhigh', 'standard']
  const actual = resolved ?? preference

  return (
    <GlassSelect
      value={preference}
      ariaLabel="选择播放音质"
      title={`当前音质：${QUALITY_LABELS[actual]}`}
      disabled={busy}
      side="top"
      className="quality-trigger"
      contentClassName="quality-menu"
      options={options.map((quality) => ({
        value: quality,
        label: QUALITY_LABELS[quality],
        trailing: actual === quality ? '当前' : undefined,
      }))}
      renderValue={() => (
        <>
          {QUALITY_LABELS[actual]}
          {!resolved ? <small>待确认</small> : resolved !== preference ? <small>已降档</small> : null}
        </>
      )}
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
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0

  return (
    <>
      <div
        className="progress"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          seek((event.clientX - rect.left) / rect.width)
        }}
      >
        <div className="fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="time">
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
  const retryWithAlternateSource = usePlayer((state) => state.retryWithAlternateSource)
  const qualityPreference = usePlayer((state) => state.qualityPreference)
  const resolvedQuality = usePlayer((state) => state.resolvedQuality)
  const setQualityPreference = usePlayer((state) => state.setQualityPreference)
  const classicTheme = useThemeStore((state) => state.selectedPresetId === 'classic-gold')
  const controlGlassRef = useClassicControlGlass(classicTheme && Boolean(current))

  useEffect(() => ticker.add(() => syncProgress()), [syncProgress])

  if (!current) return null
  const nextMode = mode === 'sequence' ? 'repeat-one' : mode === 'repeat-one' ? 'shuffle' : 'sequence'
  const modeLabel = mode === 'sequence' ? '列表循环' : mode === 'repeat-one' ? '单曲循环' : '随机播放'
  const playerMessage = status === 'loading' ? '取链中…' : message.startsWith('音质：') ? '' : message

  return (
    <div
      ref={controlGlassRef}
      className={`playerbar glass-surface${classicTheme ? ' classic-control-glass' : ''}`}
    >
      {classicTheme ? (
        <svg className="control-glass-filter-svg" aria-hidden="true" focusable="false">
          <defs dangerouslySetInnerHTML={{ __html: CLASSIC_GLASS_FILTER_SVG }} />
        </svg>
      ) : null}
      <button
        className="nav-btn"
        title="上一首"
        aria-label="上一首"
        disabled={!hasQueue}
        onClick={() => void prev()}
      >
        <PreviousIcon />
      </button>
      <button className="play-btn" aria-label={status === 'playing' ? '暂停' : '播放'} onClick={toggle}>
        {status === 'playing' ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button
        className="nav-btn"
        title="下一首"
        aria-label="下一首"
        disabled={!hasQueue}
        onClick={() => void next()}
      >
        <NextIcon />
      </button>
      <button
        className="mode-btn"
        title={`播放模式：${modeLabel}（点击切换）`}
        aria-label={`播放模式：${modeLabel}`}
        onClick={() => setMode(nextMode)}
      >
        {mode === 'sequence' ? <RepeatIcon /> : mode === 'repeat-one' ? <RepeatOneIcon /> : <ShuffleIcon />}
      </button>
      <QualityMenu
        provider={current.provider}
        preference={qualityPreference}
        resolved={resolvedQuality}
        onChange={setQualityPreference}
      />
      <div className="info">
        <div className="name">
          {current.name} — {current.artist}
        </div>
        {playerMessage || status === 'error' ? (
          <div className={`status${status === 'error' ? ' error' : ''}`}>
            <span>{playerMessage || '播放失败'}</span>
            {status === 'error' ? (
              <button type="button" className="retry-source" onClick={() => void retryWithAlternateSource()}>
                换源重试
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <PlayerProgress />
    </div>
  )
}

export function FallbackNotice(): React.JSX.Element | null {
  const notice = usePlayer((state) => state.notice)
  return notice ? <div className="fallback-notice">{notice}</div> : null
}

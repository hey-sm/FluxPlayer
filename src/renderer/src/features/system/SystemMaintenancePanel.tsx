import { useCallback, useEffect, useState } from 'react'
import type { UpdaterState, UpdaterStatus } from '@shared/updater-contract'
import { DEFAULT_UPDATER_STATE } from '@shared/updater-contract'
import { GlassSurface } from '@/components/glass'
import './SystemMaintenancePanel.css'

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
  legacy: '兼容模式不执行应用更新。',
} as const

function version(value: string | null): string {
  if (!value) return '—'
  return value.startsWith('v') ? value : `v${value}`
}

export function SystemMaintenancePanel({ className = '' }: { className?: string }) {
  const desktop = window.fluxDesktop
  const [state, setState] = useState<UpdaterState>({ ...DEFAULT_UPDATER_STATE })
  const [command, setCommand] = useState<Command | null>(null)

  useEffect(() => {
    if (!desktop) return
    let active = true
    void desktop.getUpdaterState().then((next) => active && setState(next))
    const unsubscribe = desktop.onUpdaterState((next) => active && setState(next))
    return () => { active = false; unsubscribe() }
  }, [desktop])

  const run = useCallback(async (next: Command) => {
    if (!desktop || command) return
    setCommand(next)
    try {
      const result = next === 'check'
        ? await desktop.checkForUpdates()
        : next === 'download'
          ? await desktop.downloadUpdate()
          : await desktop.installUpdate()
      setState(result.state)
    } finally {
      setCommand(null)
    }
  }, [command, desktop])

  const copy = COPY[state.status]
  const disabled = state.disabledReason ? DISABLED[state.disabledReason] : null
  const percent = Math.max(0, Math.min(100, state.progress?.percent ?? 0))
  const busy = command !== null || ['checking', 'downloading', 'progress'].includes(state.status)

  return (
    <section className={`system-maintenance-panel ${className}`.trim()} aria-label="应用更新">
      <header className="system-maintenance-heading">
        <div><span className="system-maintenance-eyebrow">FLUXPLAYER</span><h2>应用更新</h2></div>
        <p>本应用使用独立的新数据目录，更新操作不会改动个人音乐数据。</p>
      </header>
      <div className="system-maintenance-grid system-maintenance-grid--single">
        <GlassSurface className="system-maintenance-card">
          <header className="system-maintenance-card-header">
            <div><span className="system-maintenance-card-index">01</span><h3>版本与更新</h3></div>
            <span className="system-maintenance-status" data-tone={copy.tone}><span />{copy.label}</span>
          </header>
          <p className="system-maintenance-detail">{disabled ?? copy.detail}</p>
          <dl className="system-maintenance-metadata">
            <div><dt>当前版本</dt><dd>{version(state.currentVersion)}</dd></div>
            <div><dt>可用版本</dt><dd>{version(state.availableVersion)}</dd></div>
          </dl>
          {state.progress ? (
            <div className="system-maintenance-progress">
              <div className="system-maintenance-progress-heading"><strong>下载进度</strong><span>{percent.toFixed(1)}%</span></div>
              <div className="system-maintenance-progress-track"><span style={{ width: `${percent}%` }} /></div>
            </div>
          ) : null}
          {state.error ? <div className="system-maintenance-message system-maintenance-message--danger"><strong>{state.error.code}</strong><span>{state.error.message}</span></div> : null}
          <footer className="system-maintenance-actions system-maintenance-actions--updater">
            <button className="system-maintenance-button" disabled={Boolean(disabled) || busy} onClick={() => void run('check')}>{command === 'check' ? '检查中…' : '检查更新'}</button>
            <button className="system-maintenance-button system-maintenance-button--primary" disabled={Boolean(disabled) || busy || state.status !== 'available'} onClick={() => void run('download')}>{command === 'download' ? '下载中…' : '下载更新'}</button>
            <button className="system-maintenance-button system-maintenance-button--primary" disabled={Boolean(disabled) || busy || state.status !== 'downloaded'} onClick={() => void run('install')}>{command === 'install' ? '正在安装…' : '安装并重启'}</button>
          </footer>
        </GlassSurface>
      </div>
    </section>
  )
}

export default SystemMaintenancePanel

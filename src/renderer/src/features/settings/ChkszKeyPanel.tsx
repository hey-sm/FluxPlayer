import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { showToast } from '@/stores/toast'

type SaveState = 'idle' | 'saving' | 'saved'

export function ChkszKeyPanel({ className = '' }: { className?: string }): React.JSX.Element {
  const desktop = window.fluxDesktop
  const [configured, setConfigured] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [busy, setBusy] = useState(false)

  const refreshStatus = useCallback(async () => {
    if (!desktop?.chksz) return
    try {
      const { configured: hasKey, enabled: isEnabled } = await desktop.chksz.getStatus()
      setConfigured(hasKey)
      setEnabled(isEnabled)
      if (!hasKey) setShowInput(true)
    } catch {
      /* 静默：密钥状态查询失败不阻塞 UI */
    }
  }, [desktop])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const handleSave = useCallback(async () => {
    const trimmed = keyInput.trim()
    if (!desktop?.chksz || !trimmed) return
    setBusy(true)
    setSaveState('saving')
    try {
      await desktop.chksz.setKey(trimmed)
      setConfigured(true)
      setEnabled(true)
      setShowInput(false)
      setKeyInput('')
      setSaveState('saved')
      showToast('ChKSz API 已启用，无音源歌曲将自动尝试解析', { title: 'ChKSz 已接入', tone: 'info', duration: 5000 })
      setTimeout(() => setSaveState('idle'), 2000)
    } catch {
      showToast('密钥保存失败，请检查输入', { title: 'ChKSz 接入失败', tone: 'error' })
      setSaveState('idle')
    } finally {
      setBusy(false)
    }
  }, [desktop, keyInput])

  const handleToggleEnabled = useCallback(
    async (next: boolean) => {
      if (!desktop?.chksz) return
      setBusy(true)
      try {
        await desktop.chksz.setEnabled(next)
        setEnabled(next)
        showToast(next ? 'ChKSz 已启用' : 'ChKSz 已停用，播放恢复为直连', {
          title: next ? 'ChKSz 已启用' : 'ChKSz 已停用',
          tone: 'info',
        })
      } catch {
        showToast('操作失败，请重试', { tone: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [desktop],
  )

  const handleClear = useCallback(async () => {
    if (!desktop?.chksz) return
    setBusy(true)
    try {
      await desktop.chksz.clearKey()
      setConfigured(false)
      setEnabled(false)
      setShowInput(true)
      showToast('ChKSz 密钥已清除', { title: '密钥已清除', tone: 'info' })
    } catch {
      showToast('清除失败，请重试', { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }, [desktop])

  const active = configured && enabled

  return (
    <section
      className={cn('w-full text-[var(--flux-text)]', className)}
      aria-label="ChKSz 聚合 API"
      data-chksz-panel=""
    >
      <header className="mb-4 flex items-center justify-between gap-5 max-[560px]:block">
        <div className="min-w-0">
          <h2 className="text-sm leading-[1.3] font-semibold text-[var(--flux-text)]">ChKSz 聚合解析</h2>
        </div>
        <p className="max-w-[25rem] text-right text-[0.7rem] leading-[1.5] text-[var(--flux-text-muted)] max-[560px]:mt-2 max-[560px]:text-left">
          填入密钥后，无音源歌曲自动通过 ChKSz 解析。
        </p>
      </header>
      <div className="grid grid-cols-1 gap-[0.9rem]">
        <div
          className="flex min-w-0 flex-col gap-3.5 rounded-[var(--flux-glass-radius)] border border-[var(--flux-glass-border)] bg-[color-mix(in_srgb,var(--flux-glass-background)_55%,transparent)] p-4"
          data-chksz-card=""
        >
          <header className="flex items-center justify-between gap-4 max-[560px]:items-start">
            <div className="flex min-w-0 items-baseline gap-[0.62rem]">
              <span className="text-[0.62rem] font-[750] text-[color-mix(in_srgb,var(--flux-accent)_75%,white_25%)] tabular-nums">
                01
              </span>
              <h3 className="text-sm leading-[1.3] font-semibold text-[var(--flux-text)]">API 密钥</h3>
            </div>
            <span
              className={cn(
                'inline-flex min-h-[1.7rem] shrink-0 items-center gap-[0.42rem] whitespace-nowrap rounded-full border px-[0.58rem] py-1 text-[0.68rem] font-semibold',
                active
                  ? 'border-[color-mix(in_srgb,#6ed9ad_22%,transparent)] bg-[color-mix(in_srgb,#6ed9ad_7%,transparent)] text-[#86dfbd]'
                  : configured
                    ? 'border-[color-mix(in_srgb,#efbf72_22%,transparent)] bg-[color-mix(in_srgb,#efbf72_7%,transparent)] text-[#e9c58b]'
                    : 'border-[color-mix(in_srgb,var(--flux-panel-border)_8%,transparent)] bg-[color-mix(in_srgb,var(--flux-panel-border)_4%,transparent)] text-[var(--flux-text-muted)]',
              )}
            >
              <span className="size-[0.4rem] rounded-full bg-current shadow-[0_0_0.55rem_currentColor]" />
              {active ? '已启用' : configured ? '已停用' : '未配置'}
            </span>
          </header>

          <p className="text-[0.72rem] leading-[1.55] text-[var(--flux-text-muted)]">
            {active
              ? 'ChKSz 已启用：搜索和播放解析优先使用 ChKSz，无音源歌曲会自动尝试解析。密钥仅保存在本机加密存储，不会上传。'
              : configured
                ? 'ChKSz 已停用，播放恢复为直连。密钥仍保留在本机，可随时重新启用而无需重新输入。'
                : '访问 api.chksz.com 注册并获取以 chksz_ 开头的个人 API Key，填入后即可启用。密钥用于解析无音源歌曲的播放地址。'}
          </p>

          {showInput ? (
            <div className="grid gap-[0.55rem]">
              <div className="flex items-center gap-2 rounded-[calc(var(--flux-glass-radius)*0.7)] border border-[color-mix(in_srgb,var(--flux-panel-border)_6%,transparent)] bg-[color-mix(in_srgb,var(--flux-panel-surface)_58%,transparent)] px-[0.76rem] py-[0.7rem]">
                <KeyRound className="size-3.5 shrink-0 text-[var(--flux-text-muted)]" aria-hidden="true" />
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="chksz_..."
                  className="min-w-0 flex-1 bg-transparent text-[0.76rem] text-[var(--flux-text)] placeholder:text-[var(--flux-text-muted)] focus:outline-none"
                  autoComplete="off"
                  spellCheck={false}
                  data-chksz-key-input=""
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="glassRaised"
                  size="action"
                  emphasis="primary"
                  disabled={busy || !keyInput.trim()}
                  onClick={() => void handleSave()}
                >
                  {busy ? '保存中…' : '保存并启用'}
                </Button>
                {configured ? (
                  <Button variant="glassSoft" size="action" disabled={busy} onClick={() => setShowInput(false)}>
                    取消
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <footer className="flex flex-wrap items-center gap-2">
              {active ? (
                <Button variant="glassSoft" size="action" disabled={busy} onClick={() => void handleToggleEnabled(false)}>
                  {busy ? '处理中…' : '停用'}
                </Button>
              ) : configured ? (
                <Button
                  variant="glassRaised"
                  size="action"
                  emphasis="primary"
                  disabled={busy}
                  onClick={() => void handleToggleEnabled(true)}
                >
                  {busy ? '处理中…' : '启用'}
                </Button>
              ) : null}
              {configured ? (
                <>
                  <Button
                    variant="glassSoft"
                    size="action"
                    disabled={busy}
                    onClick={() => {
                      setShowInput(true)
                      setKeyInput('')
                    }}
                  >
                    更换密钥
                  </Button>
                  <Button variant="glassSoft" size="action" disabled={busy} onClick={() => void handleClear()}>
                    清除密钥
                  </Button>
                </>
              ) : (
                <Button
                  variant="glassRaised"
                  size="action"
                  emphasis="primary"
                  disabled={busy}
                  onClick={() => {
                    setShowInput(true)
                    setKeyInput('')
                  }}
                >
                  输入密钥
                </Button>
              )}
            </footer>
          )}

          {saveState === 'saving' ? (
            <div className="flex items-center gap-1.5 text-[0.66rem] text-[var(--flux-text-muted)]">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              正在验证并保存…
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default ChkszKeyPanel

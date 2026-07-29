import type { ProviderId } from '@shared/models'
import { cva } from 'class-variance-authority'
import { useAuth } from '../../stores/auth'
import { coverProxyUrl } from '../../api'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'

const accountBadgeVariants = cva('rounded-full border px-[7px] py-px text-[10px] leading-normal', {
  variants: {
    tone: {
      vip: 'border-[color-mix(in_srgb,#ffcf6a_40%,transparent)] text-[#ffcf6a]',
      warning: [
        'cursor-help border-[color-mix(in_srgb,var(--flux-danger)_40%,transparent)]',
        'text-[var(--flux-danger)]',
      ],
    },
  },
})

const accountRootClassName = ['mr-1 flex items-center gap-2', '[-webkit-app-region:no-drag]']

const accountActionClassName =
  'h-7 min-h-7 w-auto rounded-[var(--flux-radius-control)] px-3 py-0 text-xs [-webkit-app-region:no-drag]'

export function AccountArea({
  provider,
  className,
}: {
  provider: ProviderId
  className?: string
}): React.JSX.Element | null {
  const netease = useAuth((state) => state.netease)
  const qq = useAuth((state) => state.qq)
  const neteaseBusy = useAuth((state) => state.neteaseBusy)
  const qqBusy = useAuth((state) => state.qqBusy)
  const message = useAuth((state) => state.message)
  const loginNetease = useAuth((state) => state.loginNetease)
  const logoutNetease = useAuth((state) => state.logoutNetease)
  const loginQQ = useAuth((state) => state.loginQQ)
  const logoutQQ = useAuth((state) => state.logoutQQ)

  if (!window.fluxDesktop?.music) return null

  if (provider === 'qq') {
    if (qq?.loggedIn) {
      return (
        <div className={cn(accountRootClassName, className)} data-account-area="">
          {qq.avatar ? (
            <img
              className="size-6 rounded-full bg-[color-mix(in_srgb,var(--flux-panel-border)_8%,transparent)] object-cover"
              src={coverProxyUrl(qq.avatar)}
              alt=""
              data-account-avatar=""
            />
          ) : null}
          <span className="max-w-[120px] truncate text-xs" data-account-nickname="">
            {qq.nickname || (qq.preview ? '待接入' : 'QQ 用户')}
          </span>
          {qq.vipType ? <span className={accountBadgeVariants({ tone: 'vip' })}>VIP</span> : null}
          {qq.playbackKeyReady === false ? (
            <span
              className={accountBadgeVariants({ tone: 'warning' })}
              title="播放授权不完整，部分歌曲将自动换源"
            >
              授权不完整
            </span>
          ) : null}
          <Button
            variant="glassSoft"
            size="compact"
            className={accountActionClassName}
            disabled={qqBusy}
            onClick={() => void logoutQQ()}
          >
            登出
          </Button>
        </div>
      )
    }
    return (
      <div className={cn(accountRootClassName, className)} data-account-area="">
        {message ? (
          <span className="max-w-[200px] truncate text-[11px] text-[var(--flux-text-muted)]">{message}</span>
        ) : null}
        <Button
          variant="glassSoft"
          size="compact"
          className={accountActionClassName}
          disabled={qqBusy}
          onClick={() => void loginQQ()}
        >
          {qqBusy ? '登录中…' : '登录 QQ'}
        </Button>
      </div>
    )
  }

  if (netease?.loggedIn) {
    return (
      <div className={cn(accountRootClassName, className)} data-account-area="">
        {netease.avatar ? (
          <img
            className="size-6 rounded-full bg-[color-mix(in_srgb,var(--flux-panel-border)_8%,transparent)] object-cover"
            src={coverProxyUrl(netease.avatar)}
            alt=""
            data-account-avatar=""
          />
        ) : null}
        <span className="max-w-[120px] truncate text-xs" data-account-nickname="">
          {netease.nickname || '网易云用户'}
        </span>
        {netease.isVip ? (
          <span className={accountBadgeVariants({ tone: 'vip' })}>{netease.vipLabel || 'VIP'}</span>
        ) : null}
        <Button
          variant="glassSoft"
          size="compact"
          className={accountActionClassName}
          disabled={neteaseBusy}
          onClick={() => void logoutNetease()}
        >
          登出
        </Button>
      </div>
    )
  }
  return (
    <div className={cn(accountRootClassName, className)} data-account-area="">
      {message ? (
        <span className="max-w-[200px] truncate text-[11px] text-[var(--flux-text-muted)]">{message}</span>
      ) : null}
      <Button
        variant="glassSoft"
        size="compact"
        className={accountActionClassName}
        disabled={neteaseBusy}
        onClick={() => void loginNetease()}
      >
        {neteaseBusy ? '登录中…' : '登录网易云'}
      </Button>
    </div>
  )
}

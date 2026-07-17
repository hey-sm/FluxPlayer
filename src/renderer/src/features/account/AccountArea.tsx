import type { ProviderId } from '@shared/models'
import { useAuth } from '../../stores/auth'
import { coverProxyUrl } from '../../api'

export function AccountArea({ provider }: { provider: ProviderId }): React.JSX.Element | null {
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
        <div className="account">
          {qq.avatar ? <img className="avatar" src={coverProxyUrl(qq.avatar)} alt="" /> : null}
          <span className="nick">{qq.nickname || (qq.preview ? '待接入' : 'QQ 用户')}</span>
          {qq.vipType ? <span className="vip">VIP</span> : null}
          {qq.playbackKeyReady === false ? (
            <span className="warn" title="播放授权不完整，部分歌曲将自动换源">
              授权不完整
            </span>
          ) : null}
          <button className="logout" disabled={qqBusy} onClick={() => void logoutQQ()}>
            登出
          </button>
        </div>
      )
    }
    return (
      <div className="account">
        {message ? <span className="hint">{message}</span> : null}
        <button className="login" disabled={qqBusy} onClick={() => void loginQQ()}>
          {qqBusy ? '登录中…' : '登录 QQ'}
        </button>
      </div>
    )
  }

  if (netease?.loggedIn) {
    return (
      <div className="account">
        {netease.avatar ? <img className="avatar" src={coverProxyUrl(netease.avatar)} alt="" /> : null}
        <span className="nick">{netease.nickname || '网易云用户'}</span>
        {netease.isVip ? <span className="vip">{netease.vipLabel || 'VIP'}</span> : null}
        <button className="logout" disabled={neteaseBusy} onClick={() => void logoutNetease()}>
          登出
        </button>
      </div>
    )
  }
  return (
    <div className="account">
      {message ? <span className="hint">{message}</span> : null}
      <button className="login" disabled={neteaseBusy} onClick={() => void loginNetease()}>
        {neteaseBusy ? '登录中…' : '登录网易云'}
      </button>
    </div>
  )
}

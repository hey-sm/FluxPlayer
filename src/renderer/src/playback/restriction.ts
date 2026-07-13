/**
 * 不可播终态的用户文案 —— 移植旧 public/index.html 的 playbackRestrictionMessage。
 * 差异：旧版 login_required 会自动弹登录窗（后缀"正在打开登录"）；新壳默认不自动弹，
 * 改为引导右上角登录。
 */
import type { SongUrlResult, UnifiedSong } from '@shared/models'

export function providerLabel(provider: unknown): string {
  return provider === 'qq' ? 'QQ 音乐' : '网易云'
}

/** restriction 分类的唯一推导（编排层分支判断与终态文案共用同一事实来源） */
export function restrictionCategory(data: SongUrlResult | null | undefined): string {
  return (data && (data.reason || (data.restriction && data.restriction.category))) || ''
}

export function restrictionMessage(song: UnifiedSong, data: SongUrlResult | null | undefined): string {
  const payload = data || ({} as SongUrlResult)
  const restriction = payload.restriction || ({} as NonNullable<SongUrlResult['restriction']>)
  const category = restrictionCategory(payload)
  const provider = providerLabel(song.provider)
  let message = payload.message || restriction.message || ''
  if (!message) {
    if (category === 'login_required') message = `${provider}需要登录后再尝试播放`
    else if (category === 'vip_required') message = `${provider}歌曲需要会员权限`
    else if (category === 'paid_required') message = `${provider}歌曲需要购买或更高权限`
    else if (category === 'trial_only') message = `${provider}仅返回试听片段`
    else if (category === 'copyright_unavailable') message = `${provider}版权暂不可播`
    // 无分类时优先透出服务端 error 原文（如瞬时 5xx 的 HTTP 错误），别抹成泛化文案
    else message = payload.error ? String(payload.error) : `${provider}没有返回可播放地址`
  }
  if (category === 'login_required') return `${message} · 请在右上角完成登录`
  if (category === 'copyright_unavailable' || category === 'url_unavailable') return `${message} · 可以试试另一个平台版本`
  return message
}

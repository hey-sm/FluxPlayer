import type { PlaybackResolveResult } from '@shared/music-contract'
import type { UnifiedSong } from '@shared/models'

type PlaybackFailure = PlaybackResolveResult & { message?: string; error?: string }

export function providerLabel(provider: unknown): string {
  return provider === 'qq' ? 'QQ 音乐' : '网易云'
}

export function restrictionCategory(data: PlaybackResolveResult | null | undefined): string {
  return data?.reason || data?.restriction?.category || ''
}

export function restrictionMessage(song: UnifiedSong, data: PlaybackFailure | null | undefined): string {
  const category = restrictionCategory(data)
  const provider = providerLabel(song.provider)
  let message = data?.message || data?.restriction?.message || ''
  if (!message) {
    if (category === 'login_required') message = `${provider}需要登录后再尝试播放`
    else if (category === 'vip_required') message = `${provider}歌曲需要会员权限`
    else if (category === 'paid_required') message = `${provider}歌曲需要购买或更高权限`
    else if (category === 'trial_only') message = `${provider}仅返回试听片段`
    else if (category === 'copyright_unavailable') message = `${provider}版权暂不可播`
    else message = data?.error || `${provider}没有返回可播放地址`
  }
  if (category === 'login_required') return `${message} · 请在右上角完成登录`
  if (category === 'copyright_unavailable' || category === 'url_unavailable')
    return `${message} · 可以试试另一个平台版本`
  return message
}

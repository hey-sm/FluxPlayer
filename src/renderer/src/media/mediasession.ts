import type { UnifiedSong } from '@shared/models'

/**
 * 系统媒体会话桥接 —— 把 navigator.mediaSession 连到 player store。
 * 让系统媒体控件 / 键盘媒体键 / 蓝牙耳机能控制播放并显示元数据。
 *
 * 设计：不直接 import player store（避免循环依赖），由 player 在初始化时
 * 注入一组回调（bindMediaSession），切歌/状态/进度变化时主动 push。
 * 全程 feature 检测，非 Chromium 或旧环境下静默降级。
 */

export interface MediaSessionHooks {
  play(): void
  pause(): void
  next(): void
  prev(): void
  /** 绝对定位（秒） */
  seekTo(seconds: number): void
}

const supported = typeof navigator !== 'undefined' && 'mediaSession' in navigator

/** 注册系统媒体控件的动作处理器；返回解绑函数。幂等安全。 */
export function bindMediaSession(hooks: MediaSessionHooks): () => void {
  if (!supported) return () => {}
  const ms = navigator.mediaSession

  const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null): void => {
    try {
      ms.setActionHandler(action, handler)
    } catch {
      /* 该动作不受支持，忽略 */
    }
  }

  setHandler('play', () => hooks.play())
  setHandler('pause', () => hooks.pause())
  setHandler('previoustrack', () => hooks.prev())
  setHandler('nexttrack', () => hooks.next())
  setHandler('seekto', (details) => {
    if (typeof details.seekTime === 'number') hooks.seekTo(details.seekTime)
  })

  return () => {
    for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto'] as MediaSessionAction[]) {
      setHandler(action, null)
    }
  }
}

/** 切歌时刷新元数据（标题/歌手/专辑/封面）。传 null 清空。 */
export function updateMediaMetadata(song: UnifiedSong | null): void {
  if (!supported) return
  if (!song) {
    navigator.mediaSession.metadata = null
    return
  }
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.name,
      artist: song.artist,
      album: song.album || '',
      artwork: song.cover
        ? [
            {
              src: song.cover.startsWith('flux-media://cover')
                ? song.cover
                : `flux-media://cover?url=${encodeURIComponent(song.cover)}`,
              sizes: '512x512',
              type: 'image/jpeg',
            },
          ]
        : [],
    })
  } catch {
    /* MediaMetadata 不可用，忽略 */
  }
}

/** 同步播放状态到系统控件。 */
export function updatePlaybackState(state: MediaSessionPlaybackState): void {
  if (!supported) return
  try {
    navigator.mediaSession.playbackState = state
  } catch {
    /* 忽略 */
  }
}

/** 同步播放进度到系统控件（在 ticker 进度回调里调用，勿另开 RAF）。 */
export function updatePositionState(position: number, duration: number, rate = 1): void {
  if (!supported || typeof navigator.mediaSession.setPositionState !== 'function') return
  // setPositionState 对非法值会抛异常：duration 必须为正且有限，position 不得越界。
  if (!Number.isFinite(duration) || duration <= 0) {
    try {
      navigator.mediaSession.setPositionState()
    } catch {
      /* 忽略 */
    }
    return
  }
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.max(0, Math.min(position, duration)),
      playbackRate: rate > 0 ? rate : 1,
    })
  } catch {
    /* 忽略 */
  }
}

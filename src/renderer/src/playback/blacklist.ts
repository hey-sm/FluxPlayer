/**
 * 播放失败黑名单 —— 移植旧 public/index.html 的
 * markQueueItemPlaybackFailed / nextUnblockedQueueIndex。
 * 旧版把时间戳写在队列项上（_lastPlaybackFailAt）；这里改存外部 Map（provider:id 键），
 * 换源替换队列项后新项天然不背旧记录，语义等价。
 */
import type { UnifiedSong } from '@shared/models'

/** 失败后的屏蔽窗口：18 秒内跳歌时绕开该曲目 */
export const PLAYBACK_FAIL_BLOCK_MS = 18000

export function songFailKey(song: UnifiedSong): string {
  // 与取链端点的 mid 回退链保持一致（mid || songmid || id），否则黑名单键与失败的歌对不上
  return `${song.provider}:${String(song.mid || song.songmid || song.id || '')}`
}

export function markPlaybackFailed(
  map: Map<string, number>,
  song: UnifiedSong | undefined,
  now = Date.now(),
): void {
  if (!song) return
  // 顺手清掉过期条目，Map 稳态只保留活跃窗口内的几条
  for (const [key, at] of map) {
    if (now - at > PLAYBACK_FAIL_BLOCK_MS) map.delete(key)
  }
  map.set(songFailKey(song), now)
}

/** 从 fromIndex 起模轮转扫描（会绕回队首），跳过屏蔽窗口内的项；全部被屏蔽返回 -1 */
export function nextPlayableIndex(
  map: ReadonlyMap<string, number>,
  queue: readonly UnifiedSong[],
  fromIndex: number,
  now = Date.now(),
): number {
  for (let step = 1; step < queue.length; step++) {
    const idx = (fromIndex + step) % queue.length
    const failedAt = map.get(songFailKey(queue[idx])) || 0
    if (!failedAt || now - failedAt > PLAYBACK_FAIL_BLOCK_MS) return idx
  }
  return -1
}

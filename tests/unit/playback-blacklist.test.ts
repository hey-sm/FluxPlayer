import { describe, expect, it } from 'vitest'
import type { UnifiedSong } from '@shared/models'
import { makeSong } from '../helpers/song'
import {
  PLAYBACK_FAIL_BLOCK_MS,
  markPlaybackFailed,
  nextPlayableIndex,
  songFailKey,
} from '@renderer/playback/blacklist'

function song(provider: 'qq' | 'netease', id: number | string, mid?: string): UnifiedSong {
  return makeSong({ provider, source: provider, id, name: `song-${id}`, artist: 'a', mid })
}

describe('songFailKey', () => {
  it('回退链与取链端点一致：mid → songmid → id；provider 参与键', () => {
    expect(songFailKey(song('qq', 1, 'MID'))).toBe('qq:MID')
    expect(songFailKey(makeSong({ provider: 'qq', id: 7, songmid: 'SONGMID' }))).toBe('qq:SONGMID')
    expect(songFailKey(song('netease', 42))).toBe('netease:42')
  })
})

describe('markPlaybackFailed', () => {
  it('顺手清理过期条目，Map 稳态只留活跃窗口内的键', () => {
    const map = new Map<string, number>()
    const first = song('qq', 1)
    markPlaybackFailed(map, first, 0)
    markPlaybackFailed(map, song('qq', 2), PLAYBACK_FAIL_BLOCK_MS + 1000)
    expect(map.has(songFailKey(first))).toBe(false)
    expect(map.size).toBe(1)
  })
})

describe('nextPlayableIndex', () => {
  const queue = [song('qq', 1), song('qq', 2), song('qq', 3)]

  it('屏蔽窗口内跳过失败项，窗口外解禁', () => {
    const map = new Map<string, number>()
    const t0 = 1_000_000
    markPlaybackFailed(map, queue[1], t0)
    // idx0 失败后找下一个：idx1 在 18s 内被屏蔽 → idx2
    expect(nextPlayableIndex(map, queue, 0, t0 + PLAYBACK_FAIL_BLOCK_MS - 100)).toBe(2)
    // 18s 后解禁 → idx1
    expect(nextPlayableIndex(map, queue, 0, t0 + PLAYBACK_FAIL_BLOCK_MS + 100)).toBe(1)
  })

  it('模轮转绕回队首', () => {
    const map = new Map<string, number>()
    expect(nextPlayableIndex(map, queue, 2, 0)).toBe(0)
  })

  it('全部被屏蔽 → -1；单元素队列 → -1', () => {
    const map = new Map<string, number>()
    const t0 = 1_000_000
    for (const s of queue) markPlaybackFailed(map, s, t0)
    expect(nextPlayableIndex(map, queue, 0, t0 + 1000)).toBe(-1)
    expect(nextPlayableIndex(new Map(), [song('qq', 1)], 0, t0)).toBe(-1)
  })

  it('换源替换后的新项（不同 provider:id）不背旧记录', () => {
    const map = new Map<string, number>()
    const t0 = 1_000_000
    markPlaybackFailed(map, queue[1], t0)
    const replaced = [queue[0], song('netease', 999), queue[2]]
    expect(nextPlayableIndex(map, replaced, 0, t0 + 1000)).toBe(1)
  })
})

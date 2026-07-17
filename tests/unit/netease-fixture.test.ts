import { describe, expect, it, vi } from 'vitest'
import { loadFixture, normalizeNcmCover } from '../helpers/fixtures'

/**
 * 录制的真实网易云响应 fixture 快照测试（接口漂移报警器）。
 * 分诊规则：
 * - 结构不变量断言红 = 上游/NCM SDK 形状真漂移 → 修 mapper；
 * - 仅快照红 = 榜单内容轮换 → review 后 `pnpm vitest run -u` 刷新快照。
 * 重录：`pnpm record:fixtures netease`（scripts/record-fixtures.mjs，走同一 NCM SDK）。
 */

// providers/netease/index.ts 顶层 import NCM SDK；映射函数单测须 mock 掉（与 netease-mappers.test.ts 同模式）
vi.mock('@server/providers/netease/sdk', () => ({ ncm: {} }))
const { mapSongRecord } = await import('@server/providers/netease')

const cloudsearch = loadFixture('netease/cloudsearch')
const detail = loadFixture('netease/song-detail')
const playlist = loadFixture('netease/playlist-tracks')

/** 封面 CDN 主机轮换归一后再快照，避免重录假 diff */
const normCover = (s: any) => ({ ...s, cover: normalizeNcmCover(s.cover) })

describe('网易云 fixture 快照', () => {
  it('cloudsearch result.songs → mapSongRecord：不变量 + 快照', async () => {
    const songs = cloudsearch.response && cloudsearch.response.result && cloudsearch.response.result.songs
    expect(
      Array.isArray(songs) && songs.length > 0,
      `上游形状漂移：result.songs 缺失或为空（${cloudsearch.meta.endpoint}）`,
    ).toBe(true)
    const mapped = (songs as any[]).map(mapSongRecord).map(normCover)
    for (const s of mapped) {
      expect(s.id, `cloudsearch 条目缺 id：${JSON.stringify({ name: s.name })}`).toBeTruthy()
      expect(s.name).toBeTruthy()
      expect(s.duration).toBeGreaterThan(0)
      // cover 允许为空：cloudsearch 缺封面时由 provider 走 song_detail 回填
    }
    await expect(JSON.stringify(mapped, null, 2)).toMatchFileSnapshot(
      './__snapshots__/netease-search-songs.mapped.json',
    )
  })

  it('song_detail songs → mapSongRecord：固定 id 186016，全量快照', async () => {
    const songs = detail.response && detail.response.songs
    expect(
      Array.isArray(songs) && songs.length > 0,
      `上游形状漂移：songs 缺失或为空（${detail.meta.endpoint}）`,
    ).toBe(true)
    const song = normCover(mapSongRecord(songs[0]))
    expect(song.id).toBe(186016)
    expect(song.name).toBe('晴天')
    expect(song.album).toBe('叶惠美')
    expect(song.cover, 'song_detail 应带 al.picUrl（provider 依赖它做封面回填）').toBeTruthy()
    expect(song.duration).toBeGreaterThan(0)
    await expect(JSON.stringify(song, null, 2)).toMatchFileSnapshot(
      './__snapshots__/netease-detail-song.mapped.json',
    )
  })

  it('playlist_track_all songs → mapSongRecord：不变量 + 快照', async () => {
    const songs = playlist.response && (playlist.response.songs || playlist.response.tracks)
    expect(
      Array.isArray(songs) && songs.length > 0,
      `上游形状漂移：songs/tracks 缺失或为空（${playlist.meta.endpoint}）`,
    ).toBe(true)
    const mapped = (songs as any[]).map(mapSongRecord).map(normCover)
    for (const s of mapped) {
      expect(s.id).toBeTruthy()
      expect(s.name).toBeTruthy()
      expect(s.duration).toBeGreaterThan(0)
    }
    await expect(JSON.stringify(mapped, null, 2)).toMatchFileSnapshot(
      './__snapshots__/netease-playlist-songs.mapped.json',
    )
  })
})

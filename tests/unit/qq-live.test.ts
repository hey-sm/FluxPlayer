import { describe, expect, it } from 'vitest'
import { QQProvider } from '@server/providers/qq'
import type { CredentialStore } from '@server/types'

/**
 * 真实上游冒烟：只在 FLUX_LIVE=1 时跑（默认 skip，CI/离线不受影响）。
 *   pnpm vitest run tests/unit/qq-live.test.ts   （需要先设 FLUX_LIVE=1）
 * 目的：发现页 + 歌单详情 + 搜索这三条路都是匿名可用的，
 * 上游一改这里最先红，而不是等用户报"点进去空白"。
 */

const live = process.env.FLUX_LIVE === '1'
const store: CredentialStore = { get: () => '', set: () => {} }

describe.skipIf(!live)('QQ 真实上游冒烟（匿名）', () => {
  it('search 一次请求拿到完整字段', async () => {
    const songs = await new QQProvider(store).search('周杰伦 晴天', 10)
    expect(songs.length).toBeGreaterThan(0)
    expect(songs[0].mid).toBeTruthy()
    expect(songs[0].duration).toBeGreaterThan(0)
    expect(songs[0].supportedQualities?.length).toBeGreaterThan(0)
  }, 30_000)

  it('search 翻页拿到的是不同的结果', async () => {
    const provider = new QQProvider(store)
    const first = await provider.search('周杰伦', 20, 1)
    const second = await provider.search('周杰伦', 20, 2)
    expect(first.length).toBeGreaterThan(0)
    expect(second.length).toBeGreaterThan(0)
    const firstMids = new Set(first.map((song) => song.mid))
    const overlap = second.filter((song) => firstMids.has(song.mid)).length
    expect(overlap, '第二页与第一页大面积重叠，p 参数可能没生效').toBeLessThan(second.length / 2)
  }, 30_000)

  it('未登录时 discover 返回空且不报错', async () => {
    const result = await new QQProvider(store).discover(12)
    expect(result.supported).toBe(true)
    expect(result.loggedIn).toBe(false)
    expect(result.sections).toEqual([])
  }, 30_000)

  it('未登录也能点开公开歌单（发现页登录后要用这条路）', async () => {
    // 从歌单广场匿名取一个公开 dissid，验证 aiDissInfo 这条路本身是通的
    const provider = new QQProvider(store)
    const detail = await provider.playlistTracks('7707261125')
    expect(detail.tracks.length, '匿名拉不到公开歌单歌曲').toBeGreaterThan(0)
    expect(detail.playlist?.name).toBeTruthy()
    expect(detail.tracks[0].mid).toBeTruthy()
  }, 60_000)
})

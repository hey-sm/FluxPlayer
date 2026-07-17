import { describe, expect, it } from 'vitest'
import { mapQQSmartSong, mapQQTrack } from '@server/providers/qq/mappers'
import { loadFixture } from '../helpers/fixtures'

/**
 * 录制的真实 QQ 响应 fixture 快照测试（接口漂移报警器）。
 * 分诊规则：
 * - 结构不变量断言红 = 上游形状真漂移（字段改名/挪层/清空）→ 修 mapper；
 * - 仅快照红 = 榜单内容轮换 → review 后 `pnpm vitest run -u` 刷新快照。
 * 重录：`pnpm record:fixtures qq`（scripts/record-fixtures.mjs）。
 */

const smartbox = loadFixture('qq/smartbox-search')
const detail = loadFixture('qq/song-detail')

describe('QQ fixture 快照', () => {
  it('musicu get_song_detail_yqq → mapQQTrack：固定 mid，全量快照', async () => {
    const track =
      detail.response &&
      detail.response.songinfo &&
      detail.response.songinfo.data &&
      detail.response.songinfo.data.track_info
    expect(track, `上游形状漂移：songinfo.data.track_info 缺失（${detail.meta.endpoint}）`).toBeTruthy()
    const song = mapQQTrack(track)
    expect(song.mid).toBe('003OUlho2HcRHC')
    // 注意：该 mid 的真实歌曲是《告白气球》；内联测试 qq-mappers.test.ts 用同一 mid 搭配的是虚构元数据
    expect(song.name).toBe('告白气球')
    expect(song.duration).toBeGreaterThan(0)
    expect(song.cover).toMatch(/^https:\/\/y\.qq\.com\/music\/photo_new\//)
    expect(song.mediaMid, 'track_info.file.media_mid 缺失，会影响播放 URL 候选链').toBeTruthy()
    await expect(JSON.stringify(song, null, 2)).toMatchFileSnapshot('./__snapshots__/qq-track.mapped.json')
  })

  it('smartbox itemlist → mapQQSmartSong：结构不变量 + 全列表快照', async () => {
    const items =
      smartbox.response &&
      smartbox.response.data &&
      smartbox.response.data.song &&
      smartbox.response.data.song.itemlist
    expect(
      Array.isArray(items) && items.length > 0,
      `上游形状漂移：data.song.itemlist 缺失或为空（${smartbox.meta.endpoint}）`,
    ).toBe(true)
    const mapped = (items as any[]).map(mapQQSmartSong)
    for (const s of mapped) {
      // smartbox 设计上无封面无时长（duration 0 / cover ''），只保证可搜索可跳详情
      expect(s.mid, `smartbox 条目缺 mid：${JSON.stringify(s)}`).toBeTruthy()
      expect(s.name, `smartbox 条目缺 name：${JSON.stringify(s)}`).toBeTruthy()
    }
    await expect(JSON.stringify(mapped, null, 2)).toMatchFileSnapshot(
      './__snapshots__/qq-smart-songs.mapped.json',
    )
  })
})

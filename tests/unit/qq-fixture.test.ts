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
const search = loadFixture('qq/client-search')

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

  it('client_search_cp data.song.list → mapQQTrack：扁平形态一次拿全字段，无需 songDetail 补全', async () => {
    const list =
      search.response && search.response.data && search.response.data.song && search.response.data.song.list
    expect(
      Array.isArray(list) && list.length > 0,
      `上游形状漂移：data.song.list 缺失或为空（${search.meta.endpoint}）`,
    ).toBe(true)
    const rows = list as any[]
    const mapped = rows.map((item) => mapQQTrack(item))
    for (const [index, s] of mapped.entries()) {
      // 播放链路必需项：每一条都得有
      expect(s.mid, `搜索条目缺 mid：${JSON.stringify(s)}`).toBeTruthy()
      expect(s.name, `搜索条目缺 name：${JSON.stringify(s)}`).toBeTruthy()
      expect(s.duration, `搜索条目缺时长（interval 漂移？）：${s.name}`).toBeGreaterThan(0)
      expect(s.mediaMid, `搜索条目缺 mediaMid，会影响取链候选：${s.name}`).toBeTruthy()
      // size128/size320/sizeflac 是小写扁平命名，qqSupportedQualities 必须认得
      expect(
        s.supportedQualities?.length,
        `搜索条目未解析出音质能力（size* 字段名漂移？）：${s.name}`,
      ).toBeGreaterThan(0)
      // 专辑是条件项：DJ 版/UGC 上游本来就没有专辑，但只要给了 albummid 就必须映出来
      if (rows[index].albummid) {
        expect(s.album, `有 albummid 却没映出专辑名：${s.name}`).toBeTruthy()
        expect(s.cover, `有 albummid 却没拼出封面：${s.name}`).toMatch(
          /^https:\/\/y\.qq\.com\/music\/photo_new\//,
        )
      } else {
        expect(s.cover, `无 albummid 时不应臆造封面：${s.name}`).toBe('')
      }
    }
    // 相对 smartbox 的核心增量：这些字段整体不能全空，否则就是 albumname/interval 集体漂移
    expect(
      mapped.filter((s) => s.album).length,
      '整页结果都没有专辑名 —— albumname 字段可能已漂移',
    ).toBeGreaterThan(0)
    await expect(JSON.stringify(mapped, null, 2)).toMatchFileSnapshot(
      './__snapshots__/qq-search-songs.mapped.json',
    )
  })
})

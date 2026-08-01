import { describe, expect, it, vi, afterEach } from 'vitest'
import { QQProvider } from '@server/providers/qq'
import { QQClient } from '@server/providers/qq/client'
import type { CredentialStore } from '@server/types'

/**
 * 发现页 = 官方「今日为你推荐」那一行，与歌单详情取数。
 * 关键不变量（结构取自真实登录账号的 dump）：
 * - 只服务登录用户：未登录直接返回空，一个上游请求都不发；
 * - 只认 201 号货架：同一次响应还会夹带 203（普通推荐歌单）/204（更多按钮），
 *   且货架数量每次不同（实测有时 1 个、有时 8 个），不能靠顺序或数量；
 * - 只取 type=500 的卡（id 即 dissid）；800=听歌排行、-1=运营位没有播放落点；
 * - 上游对部分卡（subtype 511）不给标题，要回查歌单信息补真名，不显示空白卡；
 * - 老的 fcg_ucc_getcdinfo_byids_cp.fcg 对非自有歌单回 subcode 4000
 *   "check privacy error!"，歌单详情主路径必须是 musicu 的 aiDissInfo。
 */

function makeProvider(cookie = ''): QQProvider {
  const store: CredentialStore = { get: () => cookie, set: vi.fn() }
  return new QQProvider(store)
}

const LOGGED_IN_COOKIE = 'uin=123; qm_keyst=KEY'
const PROFILE_RESPONSE = { code: 0, data: { creator: { nick: '我' } } }

/** 形状照抄真实 dump：201 货架 + 夹带的 203/204 */
const RECOMMEND_FEED_RESPONSE = {
  req_0: {
    code: 0,
    data: {
      v_shelf: [
        {
          id: 201,
          title_content: '为你打造',
          v_niche: [
            {
              v_card: [
                { id: '5078028479', type: 500, subtype: 510, title: '每日30首', cover: 'http://x/a.jpg' },
                { id: '5441137987', type: 500, subtype: 511, title: '', cover: 'http://x/b.jpg' },
                { id: '0_8', type: 800, subtype: 810, title: '一周听歌排行' },
                { id: '0_9', type: 800, subtype: 811, title: '7月听歌排行' },
              ],
            },
          ],
        },
        { id: 204, v_niche: [{ v_card: [{ id: '', type: -1, title: '更多为你推荐' }] }] },
        {
          id: 203,
          v_niche: [{ v_card: [{ id: '7920649398', type: 500, subtype: 0, title: '全网都在听' }] }],
        },
      ],
    },
  },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('QQProvider.discover', () => {
  it('未登录直接返回空，不发任何上游请求', async () => {
    const getJSON = vi.spyOn(QQClient.prototype, 'getJSON')
    const callMusicu = vi.spyOn(QQClient.prototype, 'callMusicu')

    const result = await makeProvider('').discover(12)

    expect(result).toEqual({ provider: 'qq', supported: true, loggedIn: false, sections: [] })
    expect(getJSON).not.toHaveBeenCalled()
    expect(callMusicu).not.toHaveBeenCalled()
  })

  it('登录后只返回 201 货架的歌单卡，展示名用 subtype 固定叫法，并补上百万收藏', async () => {
    vi.spyOn(QQClient.prototype, 'getJSON').mockResolvedValue(PROFILE_RESPONSE)
    vi.spyOn(QQClient.prototype, 'callMusicu').mockImplementation(
      async (_key, module, _method, param: any) => {
        if (module === 'music.recommend.RecommendFeed') return RECOMMEND_FEED_RESPONSE
        expect(param.song_num, '补元数据不该顺带拉歌曲').toBe(1)
        return {
          req_0: {
            data: { dirinfo: { title: '百万收藏', picurl: 'http://x/m.jpg' }, total_song_num: 50 },
          },
        }
      },
    )

    const result = await makeProvider(LOGGED_IN_COOKIE).discover(3)

    expect(result.loggedIn).toBe(true)
    expect(result.sections).toHaveLength(1)
    const section = result.sections[0]
    expect(section).toMatchObject({ id: 'qq-recommend', title: '为你打造' })
    // 203 货架的「全网都在听」不能混进来；800/-1 卡丢弃；第三位补官方百万收藏
    expect(section.playlists.map((playlist) => playlist.id)).toEqual(['5078028479', '5441137987', '211111'])
    // subtype 510/511 用固定叫法：上游对 511 不给标题，实名是「<昵称>的新发风向」，做入口名不合适
    expect(section.playlists.map((playlist) => playlist.name)).toEqual(['每日30首', '新歌推荐', '百万收藏'])
  })

  it('响应里没有 201 货架时返回空 sections，而不是拿 203 顶替', async () => {
    vi.spyOn(QQClient.prototype, 'getJSON').mockResolvedValue(PROFILE_RESPONSE)
    vi.spyOn(QQClient.prototype, 'callMusicu').mockResolvedValue({
      req_0: {
        data: {
          v_shelf: [{ id: 203, v_niche: [{ v_card: [{ id: '1', type: 500, title: '普通推荐歌单' }] }] }],
        },
      },
    })

    const result = await makeProvider(LOGGED_IN_COOKIE).discover(12)
    expect(result.loggedIn).toBe(true)
    expect(result.sections).toEqual([])
  })

  it('推荐流整体失败时不抛错，只是没有内容', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(QQClient.prototype, 'getJSON').mockResolvedValue(PROFILE_RESPONSE)
    vi.spyOn(QQClient.prototype, 'callMusicu').mockRejectedValue(new Error('feed boom'))

    const result = await makeProvider(LOGGED_IN_COOKIE).discover(12)
    expect(result).toMatchObject({ supported: true, loggedIn: true, sections: [] })
  })

  it('未知 subtype 且上游没给标题、回查又失败的卡被丢掉，不显示空白卡', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(QQClient.prototype, 'getJSON').mockResolvedValue(PROFILE_RESPONSE)
    vi.spyOn(QQClient.prototype, 'callMusicu').mockImplementation(async (_key, module) => {
      if (module !== 'music.recommend.RecommendFeed') throw new Error('diss meta boom')
      return {
        req_0: {
          data: {
            v_shelf: [
              {
                id: 201,
                title_content: '为你打造',
                v_niche: [
                  {
                    v_card: [
                      { id: '1', type: 500, subtype: 510, title: '每日30首', cover: 'http://x/a.jpg' },
                      { id: '2', type: 500, subtype: 999, title: '', cover: '' },
                    ],
                  },
                ],
              },
            ],
          },
        },
      }
    })

    const result = await makeProvider(LOGGED_IN_COOKIE).discover(2)
    expect(result.sections[0].playlists.map((playlist) => playlist.name)).toEqual(['每日30首'])
  })
})

describe('QQProvider.userPlaylists', () => {
  it('自建/收藏分别打标（UI 靠 subscribed 分 tab），并丢掉 dissid=0 的伪歌单', async () => {
    vi.spyOn(QQClient.prototype, 'getJSON').mockImplementation(async (url: string) => {
      if (url.includes('profile_homepage')) return PROFILE_RESPONSE
      if (url.includes('fcg_user_created_diss')) {
        return {
          data: {
            disslist: [
              { dissid: '0', dissname: '本地上传' },
              { dissid: '0', dissname: 'QZone背景音乐' },
              { dissid: '3087337400', dissname: '我喜欢' },
              { dissid: '7829580311', dissname: '杰伦' },
            ],
          },
        }
      }
      return {
        data: {
          cdlist: [
            { dissid: '8024663626', dissname: '欧美Remix·花式碰撞的别样惊喜' },
            { dissid: '211111', dissname: '百万收藏' },
          ],
        },
      }
    })

    const result = await makeProvider(LOGGED_IN_COOKIE).userPlaylists()

    const created = result.playlists.filter((playlist) => !playlist.subscribed)
    const collected = result.playlists.filter((playlist) => playlist.subscribed)
    expect(created.map((playlist) => playlist.name)).toEqual(['我喜欢', '杰伦'])
    expect(collected.map((playlist) => playlist.name)).toEqual(['欧美Remix·花式碰撞的别样惊喜', '百万收藏'])
    // 「我喜欢」置顶不变
    expect(result.playlists[0].name).toBe('我喜欢')
  })
})

describe('QQProvider.playlistTracks', () => {
  it('普通歌单走 musicu aiDissInfo（匿名可用），不再撞老接口的 privacy error', async () => {
    const callMusicu = vi.spyOn(QQClient.prototype, 'callMusicu').mockResolvedValue({
      req_0: {
        data: {
          dirinfo: { title: '甜度爆表', creator: { nick: '西柚' } },
          total_song_num: 66,
          songlist: [
            {
              mid: '002xTzGb2UBQRk',
              name: '你的',
              interval: 163,
              album: { mid: '0023VbHy1oT80v', name: '你的' },
              file: { media_mid: '002AkhKv0YDLIl', size_flac: 19372952, size_128mp3: 100 },
              singer: [{ id: 1, mid: 'm', name: '歌手' }],
            },
          ],
        },
      },
    })
    const getJSON = vi.spyOn(QQClient.prototype, 'getJSON')

    const result = await makeProvider('').playlistTracks('7707261125')

    expect(callMusicu.mock.calls[0][1]).toBe('music.srfDissInfo.aiDissInfo')
    expect(getJSON, '主路径成功时不应再打老接口').not.toHaveBeenCalled()
    expect(result.playlist).toMatchObject({ name: '甜度爆表', trackCount: 66, creator: '西柚' })
    expect(result.tracks).toHaveLength(1)
    expect(result.tracks[0]).toMatchObject({ mid: '002xTzGb2UBQRk', name: '你的', duration: 163_000 })
    expect(result.tracks[0].supportedQualities).toEqual(['lossless', 'standard'])
  })

  it('aiDissInfo 空结果时回落到老接口', async () => {
    vi.spyOn(QQClient.prototype, 'callMusicu').mockResolvedValue({ req_0: { data: { songlist: [] } } })
    const getJSON = vi.spyOn(QQClient.prototype, 'getJSON').mockResolvedValue({
      cdlist: [{ dissname: '旧接口歌单', songlist: [{ songmid: 'X', songname: '歌', interval: 100 }] }],
    })

    const result = await makeProvider('').playlistTracks('7707261125')

    expect(getJSON).toHaveBeenCalledTimes(1)
    expect(result.playlist?.name).toBe('旧接口歌单')
    expect(result.tracks).toHaveLength(1)
  })

  it('大歌单按 total_song_num 续拉，不被单页 300 条静默截断', async () => {
    const page = (begin: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        mid: `MID_${begin + index}`,
        name: `歌 ${begin + index}`,
        interval: 100,
        album: { mid: 'a', name: '专辑' },
        file: { media_mid: 'm', size_128mp3: 100 },
        singer: [{ id: 1, mid: 's', name: '歌手' }],
      }))
    const callMusicu = vi
      .spyOn(QQClient.prototype, 'callMusicu')
      .mockImplementation(async (_key, _module, _method, param: any) => ({
        req_0: {
          data: {
            dirinfo: { title: '大歌单' },
            total_song_num: 420,
            songlist: param.song_begin === 0 ? page(0, 300) : page(300, 120),
          },
        },
      }))

    const result = await makeProvider('').playlistTracks('999')

    expect(callMusicu).toHaveBeenCalledTimes(2)
    expect(callMusicu.mock.calls[1][3]).toMatchObject({ song_begin: 300 })
    expect(result.tracks).toHaveLength(420)
    expect(result.playlist?.trackCount).toBe(420)
  })

  it('空 id 不发请求', async () => {
    const callMusicu = vi.spyOn(QQClient.prototype, 'callMusicu')
    const result = await makeProvider('').playlistTracks('  ')
    expect(callMusicu).not.toHaveBeenCalled()
    expect(result.tracks).toEqual([])
  })
})

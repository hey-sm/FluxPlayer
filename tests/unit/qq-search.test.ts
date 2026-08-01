import { afterEach, describe, expect, it, vi } from 'vitest'
import { QQProvider } from '@server/providers/qq'
import { QQClient } from '@server/providers/qq/client'
import type { CredentialStore } from '@server/types'

/**
 * QQ 搜索走 client_search_cp（真·搜索接口），不再是 smartbox（搜索联想）+ 逐条 songDetail 的 N+1。
 * 这里锁住请求参数契约与"单次请求"这个不变量；映射结果的形状由 qq-fixture.test.ts 用真实录制响应守。
 */

function makeProvider(cookie = ''): QQProvider {
  const store: CredentialStore = { get: () => cookie, set: vi.fn() }
  return new QQProvider(store)
}

function searchResponse(list: unknown[]) {
  return { code: 0, data: { song: { list, totalnum: list.length } } }
}

const SONG = {
  songmid: '0039MnYb0qxYhV',
  songid: 97773,
  songname: '晴天',
  albummid: '000MkMni19ClKG',
  albumname: '叶惠美',
  interval: 269,
  strMediaMid: '003Qui1q2u1Zho',
  singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: '周杰伦' }],
  size128: 4317292,
  size320: 10792943,
  sizeflac: 55397039,
  sizeape: 0,
  pay: { payplay: 1 },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('QQProvider.search', () => {
  it('一次 client_search_cp 请求就拿到完整字段，不再逐条补详情', async () => {
    const getJSON = vi.spyOn(QQClient.prototype, 'getJSON').mockResolvedValue(searchResponse([SONG]))
    const musicu = vi.spyOn(QQClient.prototype, 'callMusicu')

    const songs = await makeProvider().search('晴天', 20)

    expect(getJSON).toHaveBeenCalledTimes(1)
    expect(musicu, 'N+1 的 songDetail 应该已经删除').not.toHaveBeenCalled()
    expect(songs).toHaveLength(1)
    expect(songs[0]).toMatchObject({
      provider: 'qq',
      mid: '0039MnYb0qxYhV',
      name: '晴天',
      album: '叶惠美',
      artist: '周杰伦',
      mediaMid: '003Qui1q2u1Zho',
      duration: 269_000,
      fee: 1,
    })
    expect(songs[0].cover).toContain('000MkMni19ClKG')
    // size128/size320/sizeflac 的扁平小写命名要能解析出音质能力
    expect(songs[0].supportedQualities).toEqual(['lossless', 'exhigh', 'standard'])
  })

  it('请求参数契约：w/p/n + 搜索固定参数，匿名不带 cookie', async () => {
    const getJSON = vi.spyOn(QQClient.prototype, 'getJSON').mockResolvedValue(searchResponse([]))
    await makeProvider('uin=123; qm_keyst=KEY').search('周杰伦', 12, 2)

    const [targetUrl, params, opts] = getJSON.mock.calls[0]
    expect(targetUrl).toContain('client_search_cp')
    expect(params).toMatchObject({ w: '周杰伦', p: 2, n: 12, t: 0, aggr: 1, cr: 1 })
    expect(params.loginUin, '登录态应把 uin 带上').toBe('123')
    expect(opts).toEqual(expect.objectContaining({ cookie: false }))
  })

  it('limit 真正生效（不再被 smartbox 的 10 条硬顶截断）', async () => {
    const list = Array.from({ length: 30 }, (_, index) => ({
      ...SONG,
      songmid: `MID_${index}`,
      songname: `歌 ${index}`,
    }))
    vi.spyOn(QQClient.prototype, 'getJSON').mockResolvedValue(searchResponse(list))

    const songs = await makeProvider().search('周杰伦', 20)
    expect(songs).toHaveLength(20)
  })

  it('按 mid 去重，丢掉缺 mid/曲名的脏条目', async () => {
    vi.spyOn(QQClient.prototype, 'getJSON').mockResolvedValue(
      searchResponse([SONG, SONG, { ...SONG, songmid: '' }, { ...SONG, songmid: 'X', songname: '' }]),
    )
    const songs = await makeProvider().search('晴天', 20)
    expect(songs.map((song) => song.mid)).toEqual(['0039MnYb0qxYhV'])
  })

  it('空关键词直接返回空数组，不发请求', async () => {
    const getJSON = vi.spyOn(QQClient.prototype, 'getJSON')
    expect(await makeProvider().search('   ', 20)).toEqual([])
    expect(getJSON).not.toHaveBeenCalled()
  })
})

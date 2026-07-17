import { describe, expect, it, vi } from 'vitest'

// providers/netease/index.ts 顶层 import NCM SDK；单测只针对纯映射函数，mock 掉
vi.mock('@server/providers/netease/sdk', () => ({ ncm: {} }))

const { mapSongRecord, classifyNeteasePlaybackRestriction, normalizeLoginInfo } =
  await import('@server/providers/netease')

// fixture：cloudsearch songs[] 的精简形状
const NCM_SONG_FIXTURE = {
  id: 186016,
  name: '晴天',
  ar: [{ id: 6452, name: '周杰伦' }],
  al: { id: 18916, name: '叶惠美', picUrl: 'https://p1.music.126.net/x.jpg' },
  dt: 269920,
  fee: 8,
}

describe('mapSongRecord', () => {
  it('映射 cloudsearch 歌曲为统一模型', () => {
    expect(mapSongRecord(NCM_SONG_FIXTURE)).toEqual({
      provider: 'netease',
      type: 'song',
      id: 186016,
      name: '晴天',
      artist: '周杰伦',
      artists: [{ id: 6452, name: '周杰伦' }],
      artistId: 6452,
      album: '叶惠美',
      cover: 'https://p1.music.126.net/x.jpg',
      duration: 269920,
      fee: 8,
    })
  })
  it('多歌手用 / 连接', () => {
    const song = mapSongRecord({ id: 1, name: 'x', ar: [{ name: 'A' }, { name: 'B' }] })
    expect(song.artist).toBe('A / B')
  })
})

describe('classifyNeteasePlaybackRestriction', () => {
  it('未登录 → login_required', () => {
    expect(classifyNeteasePlaybackRestriction(null, { loggedIn: false }).category).toBe('login_required')
  })
  it('试听 → trial_only', () => {
    expect(
      classifyNeteasePlaybackRestriction({ freeTrialInfo: { start: 0 } }, { loggedIn: true }).category,
    ).toBe('trial_only')
  })
  it('fee=1 → vip_required；fee=4/8 → paid_required', () => {
    expect(classifyNeteasePlaybackRestriction({ fee: 1 }, { loggedIn: true }).category).toBe('vip_required')
    expect(classifyNeteasePlaybackRestriction({ fee: 8 }, { loggedIn: true }).category).toBe('paid_required')
  })
  it('code 404 → copyright_unavailable', () => {
    expect(classifyNeteasePlaybackRestriction({ code: 404 }, { loggedIn: true }).category).toBe(
      'copyright_unavailable',
    )
  })
})

describe('normalizeLoginInfo', () => {
  it('vipType>=10 判定 SVIP', () => {
    const info = normalizeLoginInfo({ userId: 1, nickname: 'N', vipType: 11 }, null)
    expect(info).toMatchObject({
      loggedIn: true,
      isVip: true,
      isSvip: true,
      vipLevel: 'svip',
      vipLabel: 'SVIP',
    })
  })
  it('无 userId → 未登录', () => {
    expect(normalizeLoginInfo({}, {}).loggedIn).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  decodeQQLyricText,
  mapQQPlaylist,
  mapQQPlaylistTrack,
  mapQQSmartSong,
  mapQQTrack,
  qqAlbumCover,
} from '@server/providers/qq/mappers'

// fixture：musicu get_song_detail_yqq 的 track_info 精简形状
const TRACK_INFO_FIXTURE = {
  id: 102065756,
  mid: '003OUlho2HcRHC',
  name: '晴天',
  interval: 269,
  singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: '周杰伦' }],
  album: { id: 20164, mid: '000MkMni19ClKG', name: '叶惠美' },
  file: {
    media_mid: '003OUlho2HcRHC',
    size_hires: 0,
    size_flac: 400,
    size_320mp3: 300,
    size_128mp3: 100,
  },
  pay: { pay_play: 1 },
  action: { switch: 16889615, msgid: 0 },
}

describe('mapQQTrack', () => {
  it('映射 musicu track_info 为统一模型', () => {
    const song = mapQQTrack(TRACK_INFO_FIXTURE)
    expect(song).toMatchObject({
      provider: 'qq',
      type: 'qq',
      id: '003OUlho2HcRHC',
      qqId: 102065756,
      mid: '003OUlho2HcRHC',
      songmid: '003OUlho2HcRHC',
      mediaMid: '003OUlho2HcRHC',
      name: '晴天',
      artist: '周杰伦',
      artistMid: '0025NhlN2yWrP4',
      album: '叶惠美',
      albumMid: '000MkMni19ClKG',
      duration: 269000,
      fee: 1,
      playable: true,
      supportedQualities: ['lossless', 'exhigh', 'standard'],
    })
    expect(song.cover).toContain('000MkMni19ClKG')
  })
  it('fallback 字段兜底（smartbox 补详情失败场景）', () => {
    const base = mapQQSmartSong({ mid: 'mid1', name: '歌', singer: '某人' })
    const song = mapQQTrack(null, base)
    expect(song.mid).toBe('mid1')
    expect(song.name).toBe('歌')
    expect(song.artist).toBe('某人')
  })
  it('action.switch=65537（bits 1-15 全 0）→ 无音源，playable: false', () => {
    const song = mapQQTrack({
      mid: 'm2',
      name: 'Got It',
      singer: [{ name: 'MKMS' }],
      album: { mid: 'alb2' },
      file: {
        media_mid: 'm2',
        size_flac: 25196104,
        size_320mp3: 4494344,
        size_128mp3: 1797880,
        size_try: 481070,
      },
      pay: { pay_play: 0 },
      action: { switch: 65537, msgid: 1 },
      fnote: 3001,
    })
    expect(song.playable).toBe(false)
    expect(song.supportedQualities).toEqual(['lossless', 'exhigh', 'standard'])
  })
  it('action.switch 有播放权限位（如 16889615）→ playable: true', () => {
    const song = mapQQTrack({
      mid: 'm3',
      name: 'GigaChad',
      singer: [{ name: '某' }],
      album: { mid: 'alb3' },
      file: { media_mid: 'm3', size_320mp3: 5853808, size_128mp3: 2341697 },
      pay: { pay_play: 1 },
      action: { switch: 16889615, msgid: 0 },
    })
    expect(song.playable).toBe(true)
  })
})

describe('mapQQPlaylistTrack', () => {
  it('qzone cdlist songlist 原生形状', () => {
    const song = mapQQPlaylistTrack({
      songid: 1,
      songmid: 'm1',
      songname: 'T',
      singername: 'A',
      albummid: 'alb',
      interval: 100,
    })
    expect(song.id).toBe('m1')
    expect(song.name).toBe('T')
    expect(song.artist).toBe('A')
    expect(song.duration).toBe(100000)
    expect(song.cover).toContain('alb')
  })
})

describe('mapQQPlaylist', () => {
  it('created/collect 双形状 + id 字符串化', () => {
    expect(mapQQPlaylist({ tid: 123, diss_name: '我的歌单', song_cnt: 9 }, 'created')).toMatchObject({
      id: '123',
      name: '我的歌单',
      trackCount: 9,
      subscribed: false,
    })
    expect(mapQQPlaylist({ dissid: '456', name: '收藏', logo: 'x.jpg' }, 'collect')).toMatchObject({
      id: '456',
      cover: 'x.jpg',
      subscribed: true,
    })
  })
})

describe('decodeQQLyricText', () => {
  it('base64 歌词解码', () => {
    const lrc = '[00:01.00]第一句'
    const b64 = Buffer.from(lrc, 'utf8').toString('base64')
    expect(decodeQQLyricText(b64)).toBe(lrc)
  })
  it('HTML 实体解码', () => {
    expect(decodeQQLyricText('[00:01.00]&#38;晴&#x5929;')).toBe('[00:01.00]&晴天')
  })
  it('已是明文 LRC 时不动', () => {
    expect(decodeQQLyricText('[00:01.00]hello')).toBe('[00:01.00]hello')
  })
})

describe('qqAlbumCover', () => {
  it('无 albumMid 返回空串', () => {
    expect(qqAlbumCover('')).toBe('')
  })
  it('生成 y.qq.com photo_new 地址', () => {
    expect(qqAlbumCover('ABC', 300)).toBe(
      'https://y.qq.com/music/photo_new/T002R300x300M000ABC.jpg?max_age=2592000',
    )
  })
})

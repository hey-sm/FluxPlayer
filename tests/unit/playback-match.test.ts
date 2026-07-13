import { describe, expect, it } from 'vitest'
import type { UnifiedSong } from '@shared/models'
import { makeSong } from '../helpers/song'
import {
  alternateProvider,
  alternateSearchPath,
  artistNameParts,
  isSameTitleArtist,
  normalizeMatchText,
  pickAlternateSong,
  searchPath,
} from '@renderer/playback/match'

const song = (partial: Partial<UnifiedSong>): UnifiedSong => makeSong(partial)

describe('normalizeMatchText', () => {
  it('去括号注音（中英文括号/方括号）', () => {
    expect(normalizeMatchText('晴天（Live）')).toBe('晴天')
    expect(normalizeMatchText('Song (feat. Someone)')).toBe('song')
    expect(normalizeMatchText('曲名【纯音乐】')).toBe('曲名')
  })

  it('去全半角标点与空白并 lowercase', () => {
    expect(normalizeMatchText('A-B_C.D，E。F：G')).toBe('abcdefg')
    expect(normalizeMatchText('  Hello · World ')).toBe('helloworld')
  })
})

describe('artistNameParts', () => {
  it('artists 数组与 artist 串（/ , 、 & feat.）都切', () => {
    const parts = artistNameParts(
      song({ artist: '周杰伦 / 费玉清', artists: [{ name: '周杰伦' }, { name: '费玉清' }] }),
    )
    expect(parts).toContain('周杰伦')
    expect(parts).toContain('费玉清')
    expect(artistNameParts(song({ artist: 'A feat. B' }))).toEqual(['a', 'b'])
    expect(artistNameParts(song({ artist: 'A & B、C' }))).toEqual(['a', 'b', 'c'])
  })
})

describe('isSameTitleArtist', () => {
  const source = song({ name: '千里之外', artist: '周杰伦/费玉清', artists: [{ name: '周杰伦' }, { name: '费玉清' }] })

  it('标题全等 + 任一歌手交集 → 命中（括号注音差异忽略）', () => {
    expect(isSameTitleArtist(source, song({ name: '千里之外 (Live)', artist: '周杰伦', provider: 'netease' }))).toBe(true)
  })

  it('同名不同歌手 → 不命中', () => {
    expect(isSameTitleArtist(source, song({ name: '千里之外', artist: '别人' }))).toBe(false)
  })

  it('同歌手不同标题 → 不命中', () => {
    expect(isSameTitleArtist(source, song({ name: '晴天', artist: '周杰伦' }))).toBe(false)
  })

  it('任一侧歌手为空 → 不命中', () => {
    expect(isSameTitleArtist(source, song({ name: '千里之外', artist: '' }))).toBe(false)
  })
})

describe('alternateProvider / searchPath / alternateSearchPath', () => {
  it('qq↔netease 互换', () => {
    expect(alternateProvider('qq')).toBe('netease')
    expect(alternateProvider('netease')).toBe('qq')
  })

  it('searchPath 是两端搜索的唯一模板', () => {
    expect(searchPath('qq', '晴天', 12)).toBe(`/api/qq/search?keywords=${encodeURIComponent('晴天')}&limit=12`)
    expect(searchPath('netease', '晴天', 20)).toBe(`/api/search?keywords=${encodeURIComponent('晴天')}&limit=20`)
  })

  it('QQ 歌 → 搜网易云 limit=12；网易歌 → 搜 QQ limit=8', () => {
    expect(alternateSearchPath(song({ provider: 'qq', name: '晴天', artist: '周杰伦' }))).toBe(
      `/api/search?keywords=${encodeURIComponent('晴天 周杰伦')}&limit=12`,
    )
    expect(alternateSearchPath(song({ provider: 'netease', name: '晴天', artist: '周杰伦' }))).toBe(
      `/api/qq/search?keywords=${encodeURIComponent('晴天 周杰伦')}&limit=8`,
    )
  })

  it('拼不出关键词 → null', () => {
    expect(alternateSearchPath(song({ name: '', artist: '' }))).toBeNull()
  })
})

describe('pickAlternateSong', () => {
  it('取第一个同名同歌手项', () => {
    const source = song({ name: '晴天', artist: '周杰伦' })
    const candidates = [
      song({ name: '晴天', artist: '别人', provider: 'netease', id: 10 }),
      song({ name: '晴天', artist: '周杰伦', provider: 'netease', id: 11 }),
      song({ name: '晴天', artist: '周杰伦', provider: 'netease', id: 12 }),
    ]
    expect(pickAlternateSong(source, candidates)?.id).toBe(11)
    expect(pickAlternateSong(source, [])).toBeNull()
  })
})

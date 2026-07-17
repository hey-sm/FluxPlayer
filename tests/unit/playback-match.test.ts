import { describe, expect, it } from 'vitest'
import type { UnifiedSong } from '@shared/models'
import { makeSong } from '../helpers/song'
import {
  alternateProvider,
  alternateSearchRequest,
  artistNameParts,
  isSameTitleArtist,
  normalizeMatchText,
  pickAlternateSong,
} from '@renderer/playback/match'

const song = (partial: Partial<UnifiedSong>): UnifiedSong => makeSong(partial)

describe('playback alternate matching', () => {
  it('normalizes annotations, punctuation and casing', () => {
    expect(normalizeMatchText('晴天（Live）')).toBe('晴天')
    expect(normalizeMatchText('Song (feat. Someone)')).toBe('song')
    expect(normalizeMatchText('A-B_C.D，E。F：G')).toBe('abcdefg')
  })

  it('combines structured and display artist names', () => {
    expect(
      artistNameParts(song({ artist: '周杰伦 / 费玉清', artists: [{ name: '周杰伦' }, { name: '费玉清' }] })),
    ).toEqual(expect.arrayContaining(['周杰伦', '费玉清']))
    expect(artistNameParts(song({ artist: 'A feat. B' }))).toEqual(['a', 'b'])
  })

  it('matches equal normalized title with any shared artist', () => {
    const source = song({
      name: '千里之外',
      artist: '周杰伦/费玉清',
      artists: [{ name: '周杰伦' }, { name: '费玉清' }],
    })
    expect(isSameTitleArtist(source, song({ name: '千里之外 (Live)', artist: '周杰伦' }))).toBe(true)
    expect(isSameTitleArtist(source, song({ name: '千里之外', artist: '别人' }))).toBe(false)
    expect(isSameTitleArtist(source, song({ name: '晴天', artist: '周杰伦' }))).toBe(false)
  })

  it('builds typed alternate requests without HTTP paths', () => {
    expect(alternateProvider('qq')).toBe('netease')
    expect(alternateProvider('netease')).toBe('qq')
    expect(alternateSearchRequest(song({ provider: 'qq', name: '晴天', artist: '周杰伦' }))).toEqual({
      provider: 'netease',
      keywords: '晴天 周杰伦',
      limit: 12,
    })
    expect(alternateSearchRequest(song({ provider: 'netease', name: '晴天', artist: '周杰伦' }))).toEqual({
      provider: 'qq',
      keywords: '晴天 周杰伦',
      limit: 8,
    })
    expect(alternateSearchRequest(song({ name: '', artist: '' }))).toBeNull()
  })

  it('picks the first matching candidate', () => {
    const source = song({ name: '晴天', artist: '周杰伦' })
    const candidates = [
      song({ name: '晴天', artist: '别人', provider: 'netease', id: 10 }),
      song({ name: '晴天', artist: '周杰伦', provider: 'netease', id: 11 }),
      song({ name: '晴天', artist: '周杰伦', provider: 'netease', id: 12 }),
    ]
    expect(pickAlternateSong(source, candidates)?.id).toBe(11)
  })
})

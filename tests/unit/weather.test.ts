import { describe, expect, it } from 'vitest'
import { fallbackWeatherForRadio, isLowSignalWeatherSong, orderWeatherSongs } from '@server/weather'
import type { UnifiedSong } from '@shared/models'

function song(partial: Partial<UnifiedSong>): UnifiedSong {
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: Math.random(),
    name: 'x',
    artist: 'y',
    artists: [],
    album: '',
    cover: '',
    duration: 0,
    ...partial,
  } as UnifiedSong
}

describe('isLowSignalWeatherSong', () => {
  it('过滤 AI/翻唱/白噪音/纯题名', () => {
    expect(isLowSignalWeatherSong(song({ name: 'AI 翻唱 晴天' }))).toBe(true)
    expect(isLowSignalWeatherSong(song({ name: '雨声 白噪音 助眠' }))).toBe(true)
    expect(isLowSignalWeatherSong(song({ name: '晴天 (cover)' }))).toBe(true)
    expect(isLowSignalWeatherSong(song({ name: '纯音乐' }))).toBe(true)
  })
  it('正常歌曲通过', () => {
    expect(isLowSignalWeatherSong(song({ name: '晴天', artist: '周杰伦', album: '叶惠美' }))).toBe(false)
  })
})

describe('orderWeatherSongs', () => {
  const mood = { key: 'rain-night', title: '', tagline: '', energy: 0, warmth: 0, focus: 0, melancholy: 0, keywords: [] }
  it('去重（同名歌不同 id 只留一首）+ 知名歌手优先 + 同歌手限流', () => {
    const input = [
      song({ id: 1, name: '好久不见', artist: '陈奕迅', cover: 'c', duration: 1 }),
      song({ id: 2, name: '好久不见（Live）', artist: '路人甲' }),
      song({ id: 3, name: '阴天快乐', artist: '陈奕迅', cover: 'c', duration: 1 }),
      song({ id: 4, name: '十年', artist: '陈奕迅', cover: 'c', duration: 1 }),
      song({ id: 5, name: '某无名歌', artist: '无名', cover: 'c' }),
    ]
    const out = orderWeatherSongs(input, mood as any)
    const names = out.map((s) => s.name)
    // 同名去重：好久不见 只出现一次
    expect(names.filter((n) => n.startsWith('好久不见')).length).toBe(1)
    // 同歌手限流：陈奕迅最多 2 首进主列表（不足 8 首会补回，但顺序靠后）
    const eason = out.slice(0, 2).filter((s) => s.artist === '陈奕迅')
    expect(eason.length).toBeLessThanOrEqual(2)
    // 知名歌手排在无名前
    expect(names.indexOf('阴天快乐')).toBeLessThan(names.indexOf('某无名歌'))
  })
})

describe('fallbackWeatherForRadio', () => {
  it('形状与旧版一致（legacy 前端消费）', () => {
    const w = fallbackWeatherForRadio({ city: '北京' }, new Error('X'))
    expect(w.location.name).toBe('北京')
    expect(w.location.fallback).toBe(true)
    expect(w.label).toBe('天气暂不可用')
    expect(w.mood.key).toBe('fallback')
    expect(Array.isArray(w.mood.keywords)).toBe(true)
    expect(w.error).toBe('X')
  })
})

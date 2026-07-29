import { describe, expect, it } from 'vitest'
import { resolveFontKey } from '@renderer/visual/lyrics3d-mesh/fonts'

describe('lyrics 3D per-line font selection', () => {
  it('routes Simplified Chinese lines to the SC face', () => {
    expect(resolveFontKey('在云端的距离 你更靠近')).toBe('sc')
    expect(resolveFontKey('端离距去靠')).toBe('sc')
  })

  it('prefers the JP face whenever kana appear, even alongside kanji', () => {
    expect(resolveFontKey('ひらがな')).toBe('jp')
    expect(resolveFontKey('カタカナ')).toBe('jp')
    expect(resolveFontKey('夜に駆ける')).toBe('jp')
    expect(resolveFontKey('ﾊﾝｶｸ')).toBe('jp')
  })

  it('treats kanji-only lines as Han, since the SC face covers them', () => {
    expect(resolveFontKey('東京')).toBe('sc')
  })

  it('routes Hangul lines to the KR face', () => {
    expect(resolveFontKey('사랑해')).toBe('kr')
    expect(resolveFontKey('안녕 hello')).toBe('kr')
  })

  it('falls back to Latin for ASCII, punctuation, and empty lines', () => {
    expect(resolveFontKey('Hello world')).toBe('latin')
    expect(resolveFontKey('...')).toBe('latin')
    expect(resolveFontKey('')).toBe('latin')
    expect(resolveFontKey('Café Ünicode')).toBe('latin')
  })

  it('picks one primary face for mixed-script lines', () => {
    expect(resolveFontKey('反 Hello 世界')).toBe('sc')
    expect(resolveFontKey('Lyrics 歌詞 テスト')).toBe('jp')
    expect(resolveFontKey('Song 노래 123')).toBe('kr')
  })

  it('returns a stable key for the same input', () => {
    const line = '在云端的距离'
    expect(resolveFontKey(line)).toBe(resolveFontKey(line))
  })
})

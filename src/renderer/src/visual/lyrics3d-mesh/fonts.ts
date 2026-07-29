/**
 * Per-line script detection for the 3D lyric layer. three-text shapes each Text.create
 * call with exactly one face and has no fallback chain, so every line picks the single
 * system face most likely to cover it. CJK/JP/KR faces all carry Latin glyphs, which is
 * why mixed lines (汉字 + Latin) are safe under the CJK keys.
 */
export type LyricsFontKey = 'latin' | 'sc' | 'jp' | 'kr'

const KANA = /[぀-ゟ゠-ヿㇰ-ㇿｦ-ﾝ]/
const HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏ꥠ-꥿ힰ-퟿]/
const HAN = /[㐀-䶿一-鿿豈-﫿]/

/** Pure: no DOM, no network. Kana wins over Han because Japanese lines mix both. */
export function resolveFontKey(text: string): LyricsFontKey {
  if (KANA.test(text)) return 'jp'
  if (HANGUL.test(text)) return 'kr'
  if (HAN.test(text)) return 'sc'
  return 'latin'
}

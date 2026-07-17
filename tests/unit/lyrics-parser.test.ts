import { describe, expect, it } from 'vitest'
import {
  buildLyricLines,
  decodeQQLyric,
  mergeLyricLines,
  parseLrc,
  parseLyricText,
  parseYrc,
  withLyricLines,
} from '@shared/lyrics'

describe('LRC parsing', () => {
  it('parses standard timestamps with one, two, and three fractional digits', () => {
    expect(parseLrc('[00:01.2]a\n[01:02.34]b\n[01:02:03.456]c')).toEqual([
      { time: 1.2, text: 'a' },
      { time: 62.34, text: 'b' },
      { time: 3723.456, text: 'c' },
    ])
  })

  it('expands multiple timestamps and sorts out-of-order input stably', () => {
    expect(parseLrc('[00:20.00][00:10.00]chorus\n[00:05.00]intro')).toEqual([
      { time: 5, text: 'intro' },
      { time: 10, text: 'chorus' },
      { time: 20, text: 'chorus' },
    ])
  })

  it('preserves duplicate timestamp lines in source order', () => {
    expect(parseLrc('[00:01]first\n[00:01]second')).toEqual([
      { time: 1, text: 'first' },
      { time: 1, text: 'second' },
    ])
  })

  it('returns no rows for empty input but retains explicitly timed empty text', () => {
    expect(parseLrc('')).toEqual([])
    expect(parseLrc('[ar:artist]\n[00:02.00]')).toEqual([{ time: 2, text: '' }])
  })

  it('applies document and caller offsets in milliseconds and clamps negative times', () => {
    expect(parseLrc('[offset:-500]\n[00:00.20]early\n[00:02.00]later', { offsetMs: 100 })).toEqual([
      { time: 0, text: 'early' },
      { time: 1.6, text: 'later' },
    ])
  })

  it('strips enhanced-LRC word timestamps while keeping its line text', () => {
    expect(parseLrc('[00:01.00]<00:01.00>Hello <00:01.50>world')).toEqual([{ time: 1, text: 'Hello world' }])
  })

  it('parses enhanced NetEase YRC line and word timing', () => {
    const yrc = '[2000,1800](2000,400,0)你(2400,500,0)好\n[500,1000](500,500,0)开场'
    expect(parseYrc(yrc)).toEqual([
      {
        time: 0.5,
        text: '开场',
        words: [
          { text: '开', time: 0.5, duration: 0.25 },
          { text: '场', time: 0.75, duration: 0.25 },
        ],
      },
      {
        time: 2,
        text: '你好',
        words: [
          { text: '你', time: 2, duration: 0.4 },
          { text: '好', time: 2.4, duration: 0.5 },
        ],
      },
    ])
    expect(parseLyricText(yrc)).toEqual(parseYrc(yrc))
  })
})

describe('translation merging and legacy construction', () => {
  it('pairs the nearest translation within tolerance without changing line timing', () => {
    const original = [
      { time: 1, text: 'one' },
      { time: 3, text: 'three' },
    ]
    const translated = [
      { time: 1.2, text: '一' },
      { time: 3.5, text: '三' },
    ]
    expect(mergeLyricLines(original, translated, { tolerance: 0.3 })).toEqual([
      { time: 1, text: 'one', ttext: '一' },
      { time: 3, text: 'three' },
    ])
    expect(original).toEqual([
      { time: 1, text: 'one' },
      { time: 3, text: 'three' },
    ])
  })

  it('matches duplicate timestamps one-to-one in stable order', () => {
    expect(
      mergeLyricLines(
        [
          { time: 1, text: 'a' },
          { time: 1, text: 'b' },
        ],
        [
          { time: 1, text: '甲' },
          { time: 1, text: '乙' },
        ],
      ),
    ).toEqual([
      { time: 1, text: 'a', ttext: '甲' },
      { time: 1, text: 'b', ttext: '乙' },
    ])
  })

  it('prefers YRC timing, merges translation by tolerance, and preserves legacy fields', () => {
    const legacy = Object.freeze({
      lyric: '[00:01.00]regular',
      tlyric: '[00:02.20]你好',
      yrc: '[2000,1000](2000,500,0)Hello',
      source: 'fixture',
    })
    const result = withLyricLines(legacy, { tolerance: 0.25 })
    expect(result).toEqual({
      ...legacy,
      lines: [
        {
          time: 2,
          text: 'Hello',
          ttext: '你好',
          words: [
            { text: 'H', time: 2, duration: 0.1 },
            { text: 'e', time: 2.1, duration: 0.1 },
            { text: 'l', time: 2.2, duration: 0.1 },
            { text: 'l', time: 2.3, duration: 0.1 },
            { text: 'o', time: 2.4, duration: 0.1 },
          ],
        },
      ],
    })
    expect(result.lyric).toBe(legacy.lyric)
    expect(result.yrc).toBe(legacy.yrc)
  })

  it('uses translated lyrics as readable text when the original is absent', () => {
    const lines = buildLyricLines({ lyric: '', tlyric: '[00:03]translated only', yrc: '' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ time: 3, text: 'translated only' })
    expect(lines[0].words?.map((word) => word.text).join('')).toBe('translated only')
    expect(lines[0].words?.every((word) => word.estimated)).toBe(true)
  })
})

describe('QQ lyric decoding', () => {
  it('decodes UTF-8 base64 in a Node/browser-safe form', () => {
    const lyric = '[00:01.00]晴天\n[00:02.00]Hello'
    expect(decodeQQLyric(Buffer.from(lyric, 'utf8').toString('base64'))).toBe(lyric)
  })

  it('decodes HTML entities before and after optional base64 decoding', () => {
    expect(decodeQQLyric('[00:01.00]&#38;晴&#x5929;&amp;')).toBe('[00:01.00]&晴天&')
  })

  it('tolerates malformed or merely base64-looking plain text without throwing', () => {
    expect(decodeQQLyric('not@@base64')).toBe('not@@base64')
    expect(decodeQQLyric('helloworld')).toBe('helloworld')
    expect(decodeQQLyric('&#999999999999;')).toBe('&#999999999999;')
    expect(decodeQQLyric(null)).toBe('')
  })
})

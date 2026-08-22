import { describe, expect, it } from 'vitest'
import { audioProbeMagic } from '@server/util/audio-probe'

describe('audioProbeMagic', () => {
  it('ID3 头 → mp3-id3', () => {
    const buf = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00])
    expect(audioProbeMagic(buf)).toBe('mp3-id3')
  })
  it('fLaC 头 → flac', () => {
    const buf = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22])
    expect(audioProbeMagic(buf)).toBe('flac')
  })
  it('OggS 头 → ogg', () => {
    const buf = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00])
    expect(audioProbeMagic(buf)).toBe('ogg')
  })
  it('RIFF...WAVE → wave', () => {
    const buf = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45])
    expect(audioProbeMagic(buf)).toBe('wave')
  })
  it('****ftyp → mp4', () => {
    const buf = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x34, 0x61, 0x21])
    expect(audioProbeMagic(buf)).toBe('mp4')
  })
  it('MPEG 帧同步 0xFFE0 → mpeg-frame', () => {
    const buf = new Uint8Array(32)
    buf[10] = 0xff
    buf[11] = 0xfb
    expect(audioProbeMagic(buf)).toBe('mpeg-frame')
  })
  it('HTML 错误页字节 → 空字符串（非音频）', () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html><body>blocked</body></html>')
    expect(audioProbeMagic(html)).toBe('')
  })
  it('空 buffer / 太短 → 空字符串', () => {
    expect(audioProbeMagic(new Uint8Array(0))).toBe('')
    expect(audioProbeMagic(new Uint8Array(2))).toBe('')
  })
})

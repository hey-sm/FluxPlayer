import { describe, expect, it } from 'vitest'
import { mediaSessionArtworkUrl } from '@renderer/media/mediasession'

describe('media session artwork', () => {
  it('accepts Chromium-supported artwork URLs and rejects custom or malformed schemes', () => {
    expect(mediaSessionArtworkUrl('https://y.gtimg.cn/cover.jpg')).toBe('https://y.gtimg.cn/cover.jpg')
    expect(mediaSessionArtworkUrl('//p1.music.126.net/cover.jpg')).toBe('https://p1.music.126.net/cover.jpg')
    expect(mediaSessionArtworkUrl('flux-media://cover?url=https%3A%2F%2Fy.qq.com%2Fcover.jpg')).toBe('')
    expect(mediaSessionArtworkUrl('<URL>')).toBe('')
  })
})

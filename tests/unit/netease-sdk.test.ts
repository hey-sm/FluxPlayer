import { describe, expect, it } from 'vitest'
import { ncm } from '@server/providers/netease/sdk'

describe('NeteaseCloudMusicApi runtime facade', () => {
  it('unwraps the CommonJS default export used in production', () => {
    expect(typeof ncm.cloudsearch).toBe('function')
    expect(typeof ncm.song_url).toBe('function')
    expect(typeof ncm.song_url_v1).toBe('function')
  })
})

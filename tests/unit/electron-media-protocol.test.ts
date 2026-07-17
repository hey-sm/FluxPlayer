import { describe, expect, it, vi } from 'vitest'
import { AudioHandleStore, handleMediaRequest, isAllowedCoverUrl } from '../../src/main/protocols/media'

describe('AudioHandleStore', () => {
  it('uses opaque handles with fixed TTL and LRU capacity eviction', () => {
    let now = 100
    let sequence = 0
    const store = new AudioHandleStore({
      capacity: 2,
      ttlMs: 50,
      now: () => now,
      createId: () => `opaque_handle_${String(++sequence).padStart(3, '0')}`,
    })

    const first = store.create({ url: 'https://music.126.net/first.mp3' })
    const second = store.create({ url: 'https://music.126.net/second.mp3' })
    expect(store.get(first)?.url).toContain('first.mp3')
    const third = store.create({ url: 'https://music.126.net/third.mp3' })

    expect(store.get(second)).toBeNull()
    expect(store.get(first)).not.toBeNull()
    expect(store.get(third)).not.toBeNull()

    now = 151
    expect(store.get(first)).toBeNull()
    expect(store.size).toBe(0)
  })

  it('keeps TTL fixed while reads promote only the LRU order', () => {
    let now = 0
    let sequence = 0
    const store = new AudioHandleStore({
      capacity: 2,
      ttlMs: 10,
      now: () => now,
      createId: () => 'fixed_ttl_handle_' + String(++sequence).padStart(2, '0'),
    })

    const first = store.create({ url: 'https://music.126.net/first.mp3' })
    now = 5
    const second = store.create({ url: 'https://music.126.net/second.mp3' })
    now = 6
    expect(store.get(first)).not.toBeNull()

    now = 10
    expect(store.get(first)).toBeNull()
    expect(store.get(second)).not.toBeNull()
    expect(store.size).toBe(1)
  })

  it('rejects non-http upstream sources', () => {
    const store = new AudioHandleStore({ createId: () => 'opaque_handle_0001' })
    expect(() => store.create({ url: 'file:///private/audio.mp3' })).toThrow('INVALID_AUDIO_SOURCE_PROTOCOL')
  })
})

describe('flux-media protocol', () => {
  it('passes Range through and preserves a 206 response', async () => {
    const store = new AudioHandleStore({ createId: () => 'opaque_audio_handle_01' })
    const handle = store.create({
      url: 'https://stream.qqmusic.qq.com/song.m4a',
      headers: { Referer: 'https://y.qq.com/' },
    })
    const fetchUpstream = vi.fn(async (_input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('range')).toBe('bytes=10-19')
      expect(headers.get('referer')).toBe('https://y.qq.com/')
      return new Response(new Uint8Array(10), {
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': '10',
          'Content-Range': 'bytes 10-19/100',
          'Content-Type': 'audio/mp4',
        },
      })
    })

    const response = await handleMediaRequest(
      store,
      new Request(`flux-media://audio/${handle}`, { headers: { Range: 'bytes=10-19' } }),
      fetchUpstream,
    )

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 10-19/100')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('access-control-allow-origin')).toBe('flux://app')
    expect(fetchUpstream).toHaveBeenCalledTimes(1)
  })

  it('returns 416 for malformed ranges without contacting upstream', async () => {
    const store = new AudioHandleStore({ createId: () => 'opaque_audio_handle_02' })
    const handle = store.create({ url: 'https://music.126.net/song.mp3' })
    const fetchUpstream = vi.fn()

    const response = await handleMediaRequest(
      store,
      new Request(`flux-media://audio/${handle}`, { headers: { Range: 'items=1-2' } }),
      fetchUpstream,
    )

    expect(response.status).toBe(416)
    expect(fetchUpstream).not.toHaveBeenCalled()
  })

  it('returns 410 for unknown or expired handles', async () => {
    let now = 0
    const store = new AudioHandleStore({
      ttlMs: 10,
      now: () => now,
      createId: () => 'opaque_audio_handle_03',
    })
    const handle = store.create({ url: 'https://music.126.net/song.mp3' })
    now = 11

    const response = await handleMediaRequest(store, new Request(`flux-media://audio/${handle}`), vi.fn())
    expect(response.status).toBe(410)
  })

  it('allows only cover CDN hosts and blocks redirects outside the allowlist', async () => {
    expect(isAllowedCoverUrl('https://p1.music.126.net/cover.jpg')).toBe(true)
    expect(isAllowedCoverUrl('https://y.qq.com.evil.example/cover.jpg')).toBe(false)
    expect(isAllowedCoverUrl('file:///cover.jpg')).toBe(false)

    const store = new AudioHandleStore()
    const blocked = await handleMediaRequest(
      store,
      new Request('flux-media://cover?url=https%3A%2F%2Fevil.example%2Fcover.jpg'),
      vi.fn(),
    )
    expect(blocked.status).toBe(403)

    const redirected = await handleMediaRequest(
      store,
      new Request('flux-media://cover?url=https%3A%2F%2Fp1.music.126.net%2Fcover.jpg'),
      vi.fn(
        async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }),
      ),
    )
    expect(redirected.status).toBe(403)
  })

  it('preserves an upstream 416 response and its unsatisfied Content-Range', async () => {
    const store = new AudioHandleStore({ createId: () => 'opaque_audio_handle_04' })
    const handle = store.create({ url: 'https://music.126.net/song.mp3' })
    const fetchUpstream = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('range')).toBe('bytes=100-')
      return new Response(null, {
        status: 416,
        headers: { 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes */100' },
      })
    })

    const response = await handleMediaRequest(
      store,
      new Request('flux-media://audio/' + handle, { headers: { Range: 'bytes=100-' } }),
      fetchUpstream,
    )

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */100')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
  })

  it('rejects an inverted byte range locally', async () => {
    const store = new AudioHandleStore({ createId: () => 'opaque_audio_handle_05' })
    const handle = store.create({ url: 'https://music.126.net/song.mp3' })
    const fetchUpstream = vi.fn()

    const response = await handleMediaRequest(
      store,
      new Request('flux-media://audio/' + handle, { headers: { Range: 'bytes=20-10' } }),
      fetchUpstream,
    )

    expect(response.status).toBe(416)
    expect(fetchUpstream).not.toHaveBeenCalled()
  })

  it('follows only allowlisted cover redirects and strips sensitive response headers', async () => {
    const store = new AudioHandleStore()
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://y.gtimg.cn/music/photo_new/cover.jpg' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg', 'Set-Cookie': 'secret=1' },
        }),
      )

    const response = await handleMediaRequest(
      store,
      new Request('flux-media://cover?url=https%3A%2F%2Fy.qq.com%2Fcover.jpg'),
      fetchUpstream,
    )

    expect(response.status).toBe(200)
    expect(fetchUpstream).toHaveBeenCalledTimes(2)
    expect(fetchUpstream.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
    expect(fetchUpstream.mock.calls[1]?.[1]).toMatchObject({ redirect: 'manual' })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('access-control-allow-origin')).toBe('flux://app')
  })

  it('matches cover hosts by DNS suffix boundary, not lookalike text', () => {
    for (const url of [
      'https://music.126.net/cover.jpg',
      'https://p1.music.126.net/cover.jpg',
      'https://y.qq.com/cover.jpg',
      'https://y.gtimg.cn/cover.jpg',
    ]) {
      expect(isAllowedCoverUrl(url), url).toBe(true)
    }
    for (const url of [
      'https://music.126.net.evil.example/cover.jpg',
      'https://notqq.com/cover.jpg',
      'https://qq.com.evil.example/cover.jpg',
      'ftp://p1.music.126.net/cover.jpg',
      'file:///cover.jpg',
    ]) {
      expect(isAllowedCoverUrl(url), url).toBe(false)
    }
  })
})

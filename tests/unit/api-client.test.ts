import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiJson, apiUrl, normalizeCoverSource } from '@renderer/api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('api client contract', () => {
  it('keeps absolute URLs and resolves local paths without a desktop bridge', () => {
    expect(apiUrl('https://example.test/data')).toBe('https://example.test/data')
    expect(apiUrl('/api/version')).toBe('/api/version')
  })

  it('rejects malformed playlist covers and normalizes legacy remote URLs', () => {
    expect(normalizeCoverSource('?n=1')).toBe('')
    expect(normalizeCoverSource('//qpic.y.qq.com/cover/300')).toBe('https://qpic.y.qq.com/cover/300')
    expect(normalizeCoverSource('http://y.gtimg.cn/cover.jpg?n=1')).toBe(
      'https://y.gtimg.cn/cover.jpg?n=1',
    )
  })

  it('returns parsed JSON for 2xx responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })))
    await expect(apiJson<{ ok: boolean }>('/api/ok')).resolves.toEqual({ ok: true })
  })

  it('throws a standard ApiError for non-2xx JSON responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"error":"LOGIN_REQUIRED","message":"请先登录"}', {
          status: 401,
          statusText: 'Unauthorized',
        }),
      ),
    )

    const error = await apiJson('/api/private').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      name: 'ApiError',
      message: '请先登录',
      status: 401,
      statusText: 'Unauthorized',
      path: '/api/private',
      payload: { error: 'LOGIN_REQUIRED', message: '请先登录' },
    })
  })

  it('preserves plain-text error bodies for diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream failed', { status: 502 })))
    await expect(apiJson('/api/audio')).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
      message: 'upstream failed',
      payload: 'upstream failed',
    })
  })
})
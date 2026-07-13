import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QQProvider } from '@server/providers/qq'
import { QQClient } from '@server/providers/qq/client'
import type { CredentialStore } from '@server/types'
import { loadFixture } from '../helpers/fixtures'

function makeProvider(cookie: string): QQProvider {
  const store: CredentialStore = { get: () => cookie, set: vi.fn() }
  return new QQProvider(store)
}

function vkeyResponse(midurlinfo: any[], sip: string[] = ['https://ws.stream.qqmusic.qq.com/']) {
  return { req_0: { data: { sip, midurlinfo } } }
}

const trialFixture = loadFixture('qq/song-url-trial')

beforeEach(() => {
  // 非试听用例默认让旧 mobile3 分支安全落空，禁止测试触网。
  vi.spyOn(QQClient.prototype, 'getJSON').mockResolvedValue({ data: { items: [] } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('QQProvider.songUrl', () => {
  it('purl 命中：url = sip + purl，level/quality 按候选反查，登录态 comm 带 authst/ct=19', async () => {
    const spy = vi
      .spyOn(QQClient.prototype, 'musicuRequest')
      .mockResolvedValue(vkeyResponse([{ filename: 'M800MEDIA.mp3', purl: 'M800MEDIA.mp3?vkey=abc' }]))
    const out = await makeProvider('uin=123; qm_keyst=KEY').songUrl('SONGMID', 'MEDIA', 'exhigh')
    expect(out.playable).toBe(true)
    expect(out.trial).toBe(false)
    expect(out.url).toBe('https://ws.stream.qqmusic.qq.com/M800MEDIA.mp3?vkey=abc')
    expect(out.level).toBe('exhigh')
    expect(out.quality).toBe('320k MP3')
    expect(out.requestedQuality).toBe('exhigh')

    const payload = spy.mock.calls[0][0] as any
    expect(payload.comm.authst).toBe('KEY')
    expect(payload.comm.ct).toBe(19)
    expect(payload.comm.uin).toBe('123')
    expect(payload.req_0.module).toBe('vkey.GetVkeyServer')
    expect(payload.req_0.param.loginflag).toBe(1)
    expect(payload.req_0.param.platform).toBe('20')
  })

  it('quality=exhigh：filename 候选只含 M800/M500/C400，按 mediaMid 优先、songmid 兜底成组（降档取链的服务端契约）', async () => {
    const spy = vi
      .spyOn(QQClient.prototype, 'musicuRequest')
      .mockResolvedValue(vkeyResponse([{ filename: '', purl: '' }]))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await makeProvider('uin=123; qm_keyst=KEY').songUrl('SONGMID', 'MEDIA', 'exhigh')
    const payload = spy.mock.calls[0][0] as any
    expect(payload.req_0.param.filename).toEqual([
      'M800MEDIA.mp3',
      'M500MEDIA.mp3',
      'C400MEDIA.m4a',
      'M800SONGMID.mp3',
      'M500SONGMID.mp3',
      'C400SONGMID.m4a',
    ])
    // songmid/songtype 数组按 filename 个数重复填充
    expect(payload.req_0.param.songmid).toHaveLength(6)
    expect(payload.req_0.param.songmid.every((m: string) => m === 'SONGMID')).toBe(true)
  })

  it('purl 缺失 → 旧 mobile3 C400 试听 vkey，返回标准 trial 元数据和限制分类', async () => {
    const musicu = vi
      .spyOn(QQClient.prototype, 'musicuRequest')
      .mockResolvedValue(vkeyResponse([{ filename: 'M800MEDIA.mp3', purl: '', result: 104003 }]))
    const legacy = vi.spyOn(QQClient.prototype, 'getJSON').mockResolvedValue(trialFixture.response)

    const out = await makeProvider('uin=123; qm_keyst=KEY').songUrl('SONGMID', 'MEDIA', 'exhigh')

    expect(musicu).toHaveBeenCalledTimes(1)
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(out.playable).toBe(true)
    expect(out.trial).toBe(true)
    expect(out.level).toBe('aac')
    expect(out.filename).toBe('C400MEDIA.m4a')
    expect(out.url).toContain('https://dl.stream.qqmusic.qq.com/C400MEDIA.m4a?')
    expect(out.url).toContain('vkey=TRIAL_VKEY_FIXTURE')
    expect(out.trialDuration).toBe(30)
    expect(out.trialInfo).toEqual({ start: 0, end: 30, duration: 30, source: 'qq-legacy-vkey' })
    expect(out.reason).toBe('trial_only')
    expect(out.restriction).toEqual(expect.objectContaining({ category: 'trial_only', action: 'upgrade', duration: 30 }))

    const [targetUrl, params, opts] = legacy.mock.calls[0]
    expect(targetUrl).toContain('fcg_music_express_mobile3.fcg')
    expect(params).toEqual(expect.objectContaining({ songmid: 'SONGMID', filename: 'C400MEDIA.m4a', uin: '0' }))
    expect(opts).toEqual(expect.objectContaining({ cookie: false }))
  })

  it('试听首候选无 vkey 时按 mediaMid → songmid 顺序兜底', async () => {
    vi.spyOn(QQClient.prototype, 'musicuRequest').mockResolvedValue(vkeyResponse([{ filename: '', purl: '' }]))
    const legacy = vi
      .spyOn(QQClient.prototype, 'getJSON')
      .mockResolvedValueOnce({ data: { items: [{ filename: 'C400MEDIA.m4a', vkey: '' }] } })
      .mockResolvedValueOnce({
        data: { items: [{ filename: 'C400SONGMID.m4a', vkey: 'SECOND_CANDIDATE' }] },
      })

    const out = await makeProvider('').songUrl('SONGMID', 'MEDIA', 'standard')

    expect(legacy).toHaveBeenCalledTimes(2)
    expect(legacy.mock.calls.map((call) => call[1].filename)).toEqual(['C400MEDIA.m4a', 'C400SONGMID.m4a'])
    expect(out.trial).toBe(true)
    expect(out.filename).toBe('C400SONGMID.m4a')
  })

  it('purl 全空 + 104003（有播放票据）：copyright_unavailable，回显 qqCode/tried，并打诊断日志', async () => {
    vi.spyOn(QQClient.prototype, 'musicuRequest').mockResolvedValue(
      vkeyResponse([{ filename: 'RS01MEDIA.flac', purl: '', result: 104003 }]),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await makeProvider('uin=123; qm_keyst=KEY').songUrl('SONGMID', 'MEDIA', 'hires')
    expect(out.playable).toBe(false)
    expect(out.url).toBe('')
    expect(out.error).toBe('QQ_URL_UNAVAILABLE')
    expect(out.reason).toBe('copyright_unavailable')
    expect(out.qqCode).toBe(104003)
    expect(out.playbackKeyReady).toBe(true)
    expect(Array.isArray(out.tried)).toBe(true)
    expect(warn).toHaveBeenCalledWith('[QQSongUrl] no purl', expect.objectContaining({ mid: 'SONGMID', qqCode: 104003 }))
  })

  it('仅网页票据（p_skey）+ 104003：归类 login_required 且 missingPlaybackKey，playbackKeyReady=false', async () => {
    vi.spyOn(QQClient.prototype, 'musicuRequest').mockResolvedValue(
      vkeyResponse([{ filename: '', purl: '', result: 104003 }]),
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await makeProvider('uin=123; p_skey=WEB').songUrl('SONGMID', 'MEDIA', 'hires')
    expect(out.reason).toBe('login_required')
    expect(out.playbackKeyReady).toBe(false)
    expect((out.restriction as any).missingPlaybackKey).toBe(true)
  })

  it('游客态：uin=0 / ct=24 / 无 authst，失败归 login_required', async () => {
    const spy = vi
      .spyOn(QQClient.prototype, 'musicuRequest')
      .mockResolvedValue(vkeyResponse([{ filename: '', purl: '' }]))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await makeProvider('').songUrl('SONGMID', '', 'hires')
    const payload = spy.mock.calls[0][0] as any
    expect(payload.comm.uin).toBe('0')
    expect(payload.comm.ct).toBe(24)
    expect(payload.comm.authst).toBeUndefined()
    expect(out.reason).toBe('login_required')
  })

  it('空 mid → MISSING_MID，不发请求', async () => {
    const spy = vi.spyOn(QQClient.prototype, 'musicuRequest')
    const out = await makeProvider('').songUrl('', '', '')
    expect(out.error).toBe('MISSING_MID')
    expect(spy).not.toHaveBeenCalled()
  })
})

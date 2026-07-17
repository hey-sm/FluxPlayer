import { describe, expect, it } from 'vitest'
import { classifyQQPlaybackRestriction } from '@server/providers/qq'

describe('classifyQQPlaybackRestriction', () => {
  it('无 session → login_required', () => {
    const r = classifyQQPlaybackRestriction({}, { hasSession: false, hasPlaybackKey: false })
    expect(r.category).toBe('login_required')
    expect(r.action).toBe('login')
  })

  it('有 session 无播放票据 + 104003 → login_required 且 missingPlaybackKey（网页态误判防线）', () => {
    const r = classifyQQPlaybackRestriction({ code: 104003 }, { hasSession: true, hasPlaybackKey: false })
    expect(r.category).toBe('login_required')
    expect(r.missingPlaybackKey).toBe(true)
  })

  it('有播放票据 + 104003 → copyright_unavailable / switch_source', () => {
    const r = classifyQQPlaybackRestriction({ code: 104003 }, { hasSession: true, hasPlaybackKey: true })
    expect(r.category).toBe('copyright_unavailable')
    expect(r.action).toBe('switch_source')
  })

  it('消息命中 vip/付费词 → paid_required', () => {
    const r = classifyQQPlaybackRestriction(
      { msg: '该歌曲需要付费购买' },
      { hasSession: true, hasPlaybackKey: true },
    )
    expect(r.category).toBe('paid_required')
    expect(r.action).toBe('upgrade')
  })

  it('其他非零 code → copyright_unavailable，透传原始消息', () => {
    const r = classifyQQPlaybackRestriction(
      { result: 2001, msg: 'blocked' },
      { hasSession: true, hasPlaybackKey: true },
    )
    expect(r.category).toBe('copyright_unavailable')
    expect(r.rawMessage).toBe('blocked')
  })

  it('零 code 无消息 → url_unavailable 兜底', () => {
    const r = classifyQQPlaybackRestriction({}, { hasSession: true, hasPlaybackKey: true })
    expect(r.category).toBe('url_unavailable')
    expect(r.action).toBe('switch_source')
  })
})

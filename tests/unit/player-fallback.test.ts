/**
 * player store 三层兜底编排测试：
 * 用 FakeAudio + mock 掉 api 模块，脚本化取链响应序列，验证
 * 降档重试 / 会话音质天花板 / 自动换源 / 跳歌黑名单 / 切歌竞态。
 * store 只依赖 Audio 全局与 EventTarget，node 环境即可跑（mediasession 有 feature 守卫）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnifiedSong } from '@shared/models'
import { makeSong } from '../helpers/song'

vi.mock('@renderer/api', () => ({
  apiJson: vi.fn(),
  audioProxyUrl: (u: string) => `proxy:${u}`,
  apiUrl: (p: string) => p,
  coverProxyUrl: (u: string) => u,
}))

class FakeAudio extends EventTarget {
  /** 按当前 src 决定 play() 成败，测试里按需改写 */
  static playScript: (src: string) => Promise<void> = () => Promise.resolve()
  src = ''
  volume = 1
  preload = ''
  currentTime = 0
  duration = NaN
  paused = true
  play(): Promise<void> {
    return FakeAudio.playScript(this.src)
  }
  pause(): void {
    this.paused = true
  }
  load(): void {}
}

function qqSong(id: number, over: Partial<UnifiedSong> = {}): UnifiedSong {
  return makeSong({
    id,
    name: `歌${id}`,
    artist: '歌手',
    artists: [{ name: '歌手' }],
    duration: 200000,
    mid: `MID${id}`,
    mediaMid: `MEDIA${id}`,
    ...over,
  })
}

const QQ_FAIL = {
  provider: 'qq',
  url: '',
  trial: false,
  playable: false,
  reason: 'copyright_unavailable',
  message: '版权受限',
  restriction: { provider: 'qq', category: 'copyright_unavailable', action: 'switch_source', message: '版权受限' },
}

let usePlayer: (typeof import('@renderer/stores/player'))['usePlayer']
let apiJson: ReturnType<typeof vi.fn>

beforeEach(async () => {
  // store 在模块初始化时就 new Audio()，必须先桩全局再动态 import；
  // resetModules 让每个用例拿到全新 store（代次/天花板/黑名单闭包状态归零）
  vi.resetModules()
  vi.stubGlobal('Audio', FakeAudio)
  FakeAudio.playScript = () => Promise.resolve()
  const api = await import('@renderer/api')
  apiJson = vi.mocked(api.apiJson) as unknown as ReturnType<typeof vi.fn>
  apiJson.mockReset()
  ;({ usePlayer } = await import('@renderer/stores/player'))
})

function calledUrls(): string[] {
  return apiJson.mock.calls.map((c) => String(c[0]))
}

describe('player 三层兜底编排', () => {
  it('将所有受限试听统一截断在 30 秒', async () => {
    apiJson.mockResolvedValue({
      provider: 'netease',
      url: 'https://cdn/trial.mp3',
      trial: true,
      playable: true,
      trialDuration: 45,
    })
    await usePlayer.getState().playList([qqSong(1, { provider: 'netease' })], 0)
    const audio = usePlayer.getState().audio as unknown as FakeAudio
    audio.duration = 45
    audio.currentTime = 30.2
    audio.dispatchEvent(new Event('timeupdate'))
    expect(audio.currentTime).toBe(30)
    expect(audio.paused).toBe(true)
    expect(usePlayer.getState()).toMatchObject({ status: 'paused', position: 30, duration: 30, message: '30 秒试听已结束' })

    let replayCalls = 0
    FakeAudio.playScript = async () => { replayCalls += 1 }
    usePlayer.getState().toggle()
    await vi.waitFor(() => expect(replayCalls).toBe(1))
    expect(audio.currentTime).toBe(0)
    expect(usePlayer.getState()).toMatchObject({ position: 0, duration: 30, message: '当前为试听片段' })
  })

  it('取链 url 空：hires→exhigh→standard 降档重取后转换源，无命中则终态（不无限重试）', async () => {
    apiJson.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/qq/song/url')) return { ...QQ_FAIL }
      if (path.startsWith('/api/search')) return { songs: [] }
      throw new Error(`unexpected: ${path}`)
    })
    await usePlayer.getState().playList([qqSong(1)], 0)
    await vi.waitFor(() => {
      expect(usePlayer.getState().status).toBe('error')
    })
    const urls = calledUrls()
    expect(urls[0]).toContain('quality=hires')
    expect(urls[1]).toContain('quality=exhigh')
    expect(urls[2]).toContain('quality=standard')
    expect(urls[3]).toMatch(/^\/api\/search\?/)
    expect(urls).toHaveLength(4)
    // 单曲队列没歌可跳 → 终态文案
    expect(usePlayer.getState().message).toContain('队列里没有其他歌曲')
  })

  it('hires purl 拿到但 play() 被拒（CDN 403）：降档重取后播放成功，且天花板压住后续高音质请求', async () => {
    apiJson.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/qq/song/url')) {
        if (path.includes('quality=exhigh')) {
          return { provider: 'qq', url: 'https://cdn/320.mp3', trial: false, playable: true, level: 'exhigh', quality: '320k MP3' }
        }
        return { provider: 'qq', url: 'https://cdn/hires.flac', trial: false, playable: true, level: 'hires', quality: 'Hi-Res FLAC' }
      }
      throw new Error(`unexpected: ${path}`)
    })
    FakeAudio.playScript = (src) =>
      src.includes('hires.flac')
        ? Promise.reject(new Error('Failed to load because no supported source is found.'))
        : Promise.resolve()

    await usePlayer.getState().playList([qqSong(1)], 0)
    await vi.waitFor(() => {
      expect(usePlayer.getState().status).toBe('playing')
    })
    const urls = calledUrls()
    expect(urls[0]).toContain('quality=hires')
    expect(urls[1]).toContain('quality=exhigh')
    expect(usePlayer.getState().message).toContain('320k')

    // 会话天花板：下一首 QQ 高音质请求直接压到 exhigh，不再先撞 403
    await usePlayer.getState().playList([qqSong(2)], 0)
    await vi.waitFor(() => {
      expect(usePlayer.getState().status).toBe('playing')
    })
    expect(calledUrls()[2]).toContain('quality=exhigh')
  })

  it('QQ 全档不可得 → 自动换源网易云同名同歌手，替换队列项并吃到试听地址', async () => {
    apiJson.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/qq/song/url')) return { ...QQ_FAIL }
      if (path.startsWith('/api/search')) {
        return {
          songs: [
            makeSong({ provider: 'netease', source: 'netease', id: 501, name: '歌1', artist: '歌手', artists: [{ name: '歌手' }], duration: 200000 }),
          ],
        }
      }
      if (path.startsWith('/api/song/url')) {
        return { provider: 'netease', url: 'https://ne/trial.mp3', trial: true, playable: true, level: 'standard', quality: '标准' }
      }
      throw new Error(`unexpected: ${path}`)
    })
    await usePlayer.getState().playList([qqSong(1)], 0)
    await vi.waitFor(() => {
      expect(usePlayer.getState().status).toBe('playing')
    })
    const state = usePlayer.getState()
    expect(state.queue[0].provider).toBe('netease')
    expect(state.queue[0].id).toBe(501)
    expect(state.message).toContain('试听')
    // 换源后的取链走网易云端点且只发生一次（fallbackDepth=1 不再二次换源）
    const neCalls = calledUrls().filter((u) => u.startsWith('/api/song/url'))
    expect(neCalls).toHaveLength(1)
  })

  it('换源无命中 → 跳到队列下一首继续播', async () => {
    apiJson.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/qq/song/url')) {
        // 歌 1 全档失败；歌 2 直接可播
        if (path.includes('mid=MID2')) {
          return { provider: 'qq', url: 'https://cdn/ok2.mp3', trial: false, playable: true, level: 'exhigh', quality: '320k MP3' }
        }
        return { ...QQ_FAIL }
      }
      if (path.startsWith('/api/search')) return { songs: [] }
      throw new Error(`unexpected: ${path}`)
    })
    await usePlayer.getState().playList([qqSong(1), qqSong(2)], 0)
    await vi.waitFor(() => {
      expect(usePlayer.getState().status).toBe('playing')
    })
    expect(usePlayer.getState().current?.id).toBe(2)
    expect(usePlayer.getState().index).toBe(1)
  })

  it('降档重试进行中用户切歌：旧代次结果被丢弃，不污染新歌状态', async () => {
    let releaseFirst: (value: unknown) => void = () => {}
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve
    })
    apiJson.mockImplementation(async (path: string) => {
      if (path.includes('mid=MID1')) {
        await firstGate // 第一首歌的取链悬住，模拟慢请求
        return { ...QQ_FAIL }
      }
      if (path.includes('mid=MID2')) {
        return { provider: 'qq', url: 'https://cdn/ok2.mp3', trial: false, playable: true, level: 'exhigh', quality: '320k MP3' }
      }
      if (path.startsWith('/api/search')) return { songs: [] }
      throw new Error(`unexpected: ${path}`)
    })
    const first = usePlayer.getState().playList([qqSong(1)], 0)
    // 取链悬住期间用户点了另一首
    await usePlayer.getState().playList([qqSong(2)], 0)
    await vi.waitFor(() => {
      expect(usePlayer.getState().status).toBe('playing')
    })
    releaseFirst(null)
    await first
    // 旧代次的失败结果不得把状态打回 error / 触发换源
    expect(usePlayer.getState().status).toBe('playing')
    expect(usePlayer.getState().current?.id).toBe(2)
    expect(calledUrls().some((u) => u.startsWith('/api/search'))).toBe(false)
  })

  it('login_required：跳过注定失败的降档重试，终态文案引导登录', async () => {
    apiJson.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/qq/song/url')) {
        return {
          provider: 'qq',
          url: '',
          trial: false,
          playable: false,
          reason: 'login_required',
          message: 'QQ 音乐需要登录后再尝试播放',
          restriction: { provider: 'qq', category: 'login_required', action: 'login', message: 'QQ 音乐需要登录后再尝试播放' },
        }
      }
      if (path.startsWith('/api/search')) return { songs: [] }
      throw new Error(`unexpected: ${path}`)
    })
    await usePlayer.getState().playList([qqSong(1)], 0)
    await vi.waitFor(() => {
      expect(usePlayer.getState().status).toBe('error')
    })
    // 只有一次取链（无 exhigh/standard 降档），换源无命中后落终态
    expect(calledUrls().filter((u) => u.startsWith('/api/qq/song/url'))).toHaveLength(1)
    expect(usePlayer.getState().message).toContain('登录')
  })

  it('换源搜索接口故障（500 → 无 songs 数组）：按"搜索失败"跳歌，而不是误报没有同名版本', async () => {
    apiJson.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/qq/song/url')) {
        if (path.includes('mid=MID2')) {
          return { provider: 'qq', url: 'https://cdn/ok2.mp3', trial: false, playable: true, level: 'exhigh', quality: '320k MP3' }
        }
        return { ...QQ_FAIL }
      }
      if (path.startsWith('/api/search')) return { error: 'boom' } // 路由 500 的形状：无 songs
      throw new Error(`unexpected: ${path}`)
    })
    await usePlayer.getState().playList([qqSong(1), qqSong(2)], 0)
    await vi.waitFor(() => {
      expect(usePlayer.getState().status).toBe('playing')
    })
    expect(usePlayer.getState().current?.id).toBe(2)
    expect(usePlayer.getState().notice).toContain('搜索失败')
  })

  it('autoplay 被策略拒绝（NotAllowedError）：不跳歌不拉黑，提示点击播放继续', async () => {
    apiJson.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/qq/song/url')) {
        return { provider: 'qq', url: 'https://cdn/ok.mp3', trial: false, playable: true, level: 'exhigh', quality: '320k MP3' }
      }
      throw new Error(`unexpected: ${path}`)
    })
    FakeAudio.playScript = () => {
      const err = new Error('play() can only be initiated by a user gesture.')
      err.name = 'NotAllowedError'
      return Promise.reject(err)
    }
    await usePlayer.getState().playList([qqSong(1), qqSong(2)], 0)
    await vi.waitFor(() => {
      expect(usePlayer.getState().status).toBe('paused')
    })
    expect(usePlayer.getState().message).toContain('点击播放')
    expect(usePlayer.getState().current?.id).toBe(1) // 没有级联跳歌
  })

  it('取链窗口期旧曲 ended 不劫持队列前进', async () => {
    let releaseFetch: (value: unknown) => void = () => {}
    const gate = new Promise((resolve) => {
      releaseFetch = resolve
    })
    apiJson.mockImplementation(async (path: string) => {
      if (path.includes('mid=MID1')) {
        return { provider: 'qq', url: 'https://cdn/ok1.mp3', trial: false, playable: true, level: 'exhigh', quality: '320k MP3' }
      }
      if (path.includes('mid=MID2')) {
        await gate // 第 2 首取链悬住
        return { provider: 'qq', url: 'https://cdn/ok2.mp3', trial: false, playable: true, level: 'exhigh', quality: '320k MP3' }
      }
      throw new Error(`unexpected: ${path}`)
    })
    await usePlayer.getState().playList([qqSong(1), qqSong(2), qqSong(3)], 0)
    const audio = usePlayer.getState().audio
    const second = usePlayer.getState().next()
    await vi.waitFor(() => {
      expect(usePlayer.getState().status).toBe('loading')
    })
    // 旧曲（第 1 首）此刻自然播完：loading 守卫应忽略，不得推进到第 3 首
    audio.dispatchEvent(new Event('ended'))
    releaseFetch(null)
    await second
    await vi.waitFor(() => {
      expect(usePlayer.getState().status).toBe('playing')
    })
    expect(usePlayer.getState().current?.id).toBe(2)
  })
})

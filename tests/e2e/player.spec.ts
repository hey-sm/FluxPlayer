import { E2E_WAV_FIXTURE_URL, expect, fulfillE2EWav, test } from './electron.fixture'

const TRACK = {
  provider: 'netease',
  source: 'netease',
  type: 'song',
  id: 61_000_001,
  name: 'Playwright 内存音轨',
  artist: 'FluxPlayer E2E',
  artists: [{ id: 61_000_002, name: 'FluxPlayer E2E' }],
  album: '确定性 WAV',
  cover: '',
  duration: 8_000,
  fee: 0,
  playable: true,
} as const

const UPSTREAM_AUDIO_URL = E2E_WAV_FIXTURE_URL

async function inspectTrackedAudio(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const tracked = (globalThis as typeof globalThis & { __fluxE2EAudioElements?: HTMLAudioElement[] })
      .__fluxE2EAudioElements
    const audio = tracked?.at(-1)
    return {
      count: tracked?.length ?? 0,
      exists: Boolean(audio),
      paused: audio?.paused ?? true,
      ended: audio?.ended ?? false,
      currentTime: audio?.currentTime ?? 0,
      duration: audio?.duration ?? 0,
      readyState: audio?.readyState ?? 0,
      src: audio?.src ?? '',
    }
  })
}

test('窗口可见，搜索点歌后真实音频播放并正常退出', async ({ electronHarness }) => {
  const { app, page, rendererCrashes } = electronHarness
  const intercepted = { search: [] as string[], songUrl: [] as string[], audio: [] as string[] }

  await page.route('**/api/search**', async (route) => {
    const url = new URL(route.request().url())
    intercepted.search.push(url.toString())
    expect(url.searchParams.get('keywords')).toBe('M6 E2E')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ songs: [TRACK] }),
    })
  })

  await page.route('**/api/song/url**', async (route) => {
    const url = new URL(route.request().url())
    intercepted.songUrl.push(url.toString())
    expect(url.searchParams.get('id')).toBe(String(TRACK.id))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'netease',
        url: UPSTREAM_AUDIO_URL,
        trial: false,
        playable: true,
        level: 'lossless',
        quality: 'E2E WAV',
      }),
    })
  })

  await page.route('**/api/audio**', async (route) => {
    const url = new URL(route.request().url())
    intercepted.audio.push(url.toString())
    expect(url.searchParams.get('url')).toBe(UPSTREAM_AUDIO_URL)
    await fulfillE2EWav(route)
  })

  await page.route('**/api/lyric**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lyric: '', tlyric: '', yrc: '', lines: [] }),
    }),
  )

  await expect(page).toHaveTitle(/FluxPlayer/i)
  await expect(page.locator('.stage-bg')).toBeVisible()
  await expect(page.locator('.stage-bg canvas')).toHaveCount(1)
  await expect(page.locator('.visual-toggle')).toHaveCount(0)
  const mainWindow = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .map((window) => ({
        destroyed: window.isDestroyed(),
        visible: window.isVisible(),
        title: window.getTitle(),
        rendererCrashed:
          typeof window.webContents.isCrashed === 'function' ? window.webContents.isCrashed() : false,
      }))
      .find((window) => /FluxPlayer/i.test(window.title)),
  )
  expect(mainWindow).toEqual({
    destroyed: false,
    visible: true,
    title: expect.stringMatching(/FluxPlayer/i),
    rendererCrashed: false,
  })

  await page.getByPlaceholder(/搜索歌曲/).fill('M6 E2E')
  const searchResults = page.getByRole('region', { name: '搜索结果' })
  const song = searchResults.getByText(TRACK.name, { exact: true })
  await expect(song).toBeVisible()
  expect(intercepted.search).toHaveLength(1)

  await song.click()
  await expect(page.getByText(`${TRACK.name} — ${TRACK.artist}`, { exact: true })).toBeVisible()
  await expect(page.getByText('音质：E2E WAV', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible()

  await expect.poll(async () => (await inspectTrackedAudio(page)).exists).toBe(true)
  await expect.poll(async () => (await inspectTrackedAudio(page)).paused).toBe(false)
  const initialTime = (await inspectTrackedAudio(page)).currentTime
  await expect
    .poll(async () => (await inspectTrackedAudio(page)).currentTime, {
      message: 'the real HTMLAudioElement currentTime should advance',
      timeout: 8_000,
    })
    .toBeGreaterThan(initialTime + 0.25)

  const audioState = await inspectTrackedAudio(page)
  expect(audioState).toEqual(
    expect.objectContaining({
      count: 1,
      exists: true,
      paused: false,
      ended: false,
    }),
  )
  expect(audioState.readyState).toBeGreaterThanOrEqual(2)
  expect(audioState.duration).toBeGreaterThan(7)
  expect(audioState.src).toContain('/api/audio?url=')
  expect(intercepted.songUrl).toHaveLength(1)
  expect(intercepted.audio.length).toBeGreaterThanOrEqual(1)
  expect(rendererCrashes).toEqual([])

  await page.getByTitle('关闭', { exact: true }).click()
  const exit = await electronHarness.waitForExit()
  expect(exit.signal).toBeNull()
  expect(exit.code).toBe(0)
})

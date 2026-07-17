import { E2E_AUDIO_URL, expect, test } from './electron.fixture'

const TRACK = {
  provider: 'netease',
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
  await electronHarness.installMusicFixture({
    query: 'M6 E2E',
    track: TRACK,
    quality: 'E2E WAV',
  })

  await expect(page).toHaveURL(/^flux:\/\/app\//)
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

  const shellLayout = await page.evaluate(() => {
    const topbar = document.querySelector<HTMLElement>('.topbar')!
    const library = document.querySelector<HTMLElement>('.flux-library-sheet')!
    const topbarRect = topbar.getBoundingClientRect()
    const libraryRect = library.getBoundingClientRect()
    return {
      topbarBackground: getComputedStyle(topbar).backgroundColor,
      topbarBottom: topbarRect.bottom,
      libraryTop: libraryRect.top,
      libraryBottom: libraryRect.bottom,
      viewportHeight: window.innerHeight,
    }
  })
  expect(shellLayout.topbarBackground).toBe('rgba(0, 0, 0, 0)')
  expect(shellLayout.libraryTop).toBeCloseTo(shellLayout.topbarBottom, 0)
  expect(shellLayout.libraryBottom).toBeCloseTo(shellLayout.viewportHeight, 0)

  await page.getByRole('button', { name: '设置' }).click()
  const motionSelect = page.getByRole('combobox', { name: '界面动效' })
  await expect(motionSelect).toBeVisible()
  await expect(motionSelect).toHaveJSProperty('tagName', 'BUTTON')
  await motionSelect.click()
  await expect(page.getByRole('option', { name: '弹性浮现' })).toBeVisible()
  await expect(page.locator('.glass-select-content .flux-liquid-glass')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '关闭' }).click()

  await page.getByPlaceholder(/搜索歌曲/).fill('M6 E2E')
  const searchResults = page.getByRole('region', { name: '搜索结果' })
  const song = searchResults.getByText(TRACK.name, { exact: true })
  await expect(song).toBeVisible()
  await expect
    .poll(async () => {
      const calls = await electronHarness.musicCalls()
      return calls.filter((call) => call.channel === 'flux:music:search').length
    })
    .toBe(2)

  await song.click()
  await expect(page.getByText(`${TRACK.name} — ${TRACK.artist}`, { exact: true })).toBeVisible()
  await expect(page.getByText('音质：E2E WAV', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible()
  const playerAlignment = await page.evaluate(() => {
    const quality = document.querySelector<HTMLElement>('.quality-trigger')!.getBoundingClientRect()
    const info = document.querySelector<HTMLElement>('.playerbar .info')!.getBoundingClientRect()
    const progress = document.querySelector<HTMLElement>('.playerbar .progress')!.getBoundingClientRect()
    return [quality, info, progress].map((rect) => rect.top + rect.height / 2)
  })
  expect(Math.max(...playerAlignment) - Math.min(...playerAlignment)).toBeLessThan(1)

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
  expect(audioState.src).toBe(E2E_AUDIO_URL)
  const musicCalls = await electronHarness.musicCalls()
  expect(
    musicCalls.filter((call) => call.channel === 'flux:music:search').map((call) => call.payload),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ provider: 'netease', keywords: 'M6 E2E' }),
      expect.objectContaining({ provider: 'qq', keywords: 'M6 E2E' }),
    ]),
  )
  expect(musicCalls.filter((call) => call.channel === 'flux:music:resolve-playback')).toEqual([
    expect.objectContaining({
      payload: expect.objectContaining({
        song: expect.objectContaining({ provider: 'netease', id: TRACK.id }),
      }),
    }),
  ])
  expect(rendererCrashes).toEqual([])

  await page.getByRole('button', { name: '关闭', exact: true }).click()
  const exit = await electronHarness.waitForExit()
  expect(exit.signal).toBeNull()
  expect(exit.code).toBe(0)
})

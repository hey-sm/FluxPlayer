import sharp from 'sharp'
import type { Locator, Page, TestInfo } from '@playwright/test'
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

async function captureVisual(page: Page, canvas: Locator, testInfo: TestInfo, name: string): Promise<void> {
  await page.waitForTimeout(250)
  const canvasPixels = await canvas.screenshot()
  const stats = await sharp(canvasPixels).stats()
  const colorChannels = stats.channels.slice(0, 3)
  expect(Math.max(...colorChannels.map((channel) => channel.max))).toBeGreaterThan(18)
  expect(Math.max(...colorChannels.map((channel) => channel.stdev))).toBeGreaterThan(1)
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) })
}

async function imageDelta(before: Buffer, after: Buffer): Promise<number> {
  const [beforePixels, afterPixels] = await Promise.all(
    [before, after].map((image) => sharp(image).removeAlpha().resize(96, 54).raw().toBuffer()),
  )
  let difference = 0
  for (let index = 0; index < beforePixels.length; index += 1) {
    difference += Math.abs(beforePixels[index] - afterPixels[index])
  }
  return difference / beforePixels.length
}

test('窗口可见，搜索点歌后真实音频播放并正常退出', async ({ electronHarness }, testInfo) => {
  const { app, page, rendererCrashes } = electronHarness
  await electronHarness.installMusicFixture({
    query: 'M6 E2E',
    track: TRACK,
    quality: 'E2E WAV',
  })

  await expect(page).toHaveURL(/^flux:\/\/app\//)
  await expect(page).toHaveTitle(/FluxPlayer/i)
  await expect(page.locator('.stage-bg')).toBeVisible()
  const stageCanvas = page.locator('.stage-bg canvas')
  await expect(stageCanvas).toHaveCount(1)
  await captureVisual(page, stageCanvas, testInfo, 'light-rays-desktop')
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
  expect(shellLayout.viewportHeight - shellLayout.libraryBottom).toBeCloseTo(104, 0)
  await expect(page.locator('.flux-library-sheet')).toHaveAttribute('data-animation-direction', 'horizontal')
  await expect(page.locator('.flux-library-sheet')).toHaveAttribute('data-animation-reverse', 'true')
  await expect(page.locator('.flux-detail-sheet')).toHaveAttribute('data-animation-direction', 'horizontal')
  await expect(page.locator('.flux-detail-sheet')).toHaveAttribute('data-animation-reverse', 'false')
  await expect(page.locator('.search-animated-content')).toHaveAttribute(
    'data-animation-direction',
    'vertical',
  )
  await expect(page.locator('.search-animated-content')).toHaveAttribute('data-animation-reverse', 'true')

  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByRole('combobox', { name: '界面动效' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '音乐视觉' })).toHaveCount(0)
  const backgroundSelect = page.getByRole('combobox', { name: '动态背景' })
  await expect(backgroundSelect).toContainText('光线')
  await backgroundSelect.click()
  await expect(page.locator('.glass-select-content .flux-liquid-glass')).toBeVisible()
  await page.getByRole('option', { name: '星河' }).click()
  await expect(backgroundSelect).toContainText('星河')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fluxplayer-dynamic-background-v1')))
    .toBe('galaxy')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fluxplayer-visual-preset-v1'))).toBeNull()
  await expect(page.locator('.stage-bg canvas')).toHaveCount(1)

  await page.getByRole('button', { name: '关闭' }).click()
  await captureVisual(page, stageCanvas, testInfo, 'galaxy-desktop')

  await page.getByRole('button', { name: '设置' }).click()
  await backgroundSelect.click()
  await page.getByRole('option', { name: '吊灯' }).click()
  await expect(backgroundSelect).toContainText('吊灯')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fluxplayer-dynamic-background-v1')))
    .toBe('html-light')
  await expect(page.locator('.stage-bg canvas')).toHaveCount(1)
  await page.getByRole('button', { name: '关闭' }).click()
  await captureVisual(page, stageCanvas, testInfo, 'html-light-desktop')

  const lampBeforeDrag = await stageCanvas.screenshot()
  const stageBounds = await stageCanvas.boundingBox()
  expect(stageBounds).not.toBeNull()
  await page.mouse.move(
    stageBounds!.x + stageBounds!.width * 0.5,
    stageBounds!.y + stageBounds!.height * 0.18,
  )
  await page.mouse.down()
  await page.mouse.move(
    stageBounds!.x + stageBounds!.width * 0.64,
    stageBounds!.y + stageBounds!.height * 0.3,
    {
      steps: 6,
    },
  )
  await page.mouse.up()
  await page.waitForTimeout(100)
  expect(await imageDelta(lampBeforeDrag, await stageCanvas.screenshot())).toBeGreaterThan(0.15)

  const searchSensor = page.locator('.search-hover-sensor')
  const searchShell = page.locator('.search-shell')
  const searchInput = page.getByPlaceholder(/搜索歌曲/)
  await expect(searchInput).not.toBeVisible()

  await searchSensor.hover()
  await expect(searchShell).toHaveClass(/is-visible/)
  await expect(searchInput).toBeVisible()
  await searchInput.fill('M6 E2E')
  const searchResults = page.getByRole('region', { name: '搜索结果' })
  const song = searchResults.getByText(TRACK.name, { exact: true })
  await expect(song).toBeVisible()

  await searchResults.hover()
  await expect(searchShell).toHaveClass(/is-visible/)
  await expect(searchResults).toBeVisible()

  await searchInput.evaluate((input) => input.blur())
  await page.mouse.move(1, Math.floor((page.viewportSize()?.height ?? 720) / 2))
  await expect(searchShell).not.toHaveClass(/is-visible/)
  await expect(searchInput).not.toBeVisible()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await searchSensor.hover()
  await expect
    .poll(() =>
      page.locator('.search-animated-content').evaluate((element) => ({
        opacity: getComputedStyle(element).opacity,
        transform: getComputedStyle(element).transform,
      })),
    )
    .toEqual({ opacity: '1', transform: 'matrix(1, 0, 0, 1, 0, 0)' })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(song).toBeVisible()
  await expect
    .poll(async () => {
      const calls = await electronHarness.musicCalls()
      return calls.filter((call) => call.channel === 'flux:music:search').length
    })
    .toBe(2)

  await song.click()
  await expect(page.getByText(`${TRACK.name} — ${TRACK.artist}`, { exact: true })).toBeVisible()
  await expect(page.locator('.flux-library-sheet')).toHaveAttribute('aria-hidden', 'true')
  await expect(page.getByText('音质：E2E WAV', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible()
  const playerAlignment = await page.evaluate(() => {
    const quality = document.querySelector<HTMLElement>('.quality-trigger')!.getBoundingClientRect()
    const info = document.querySelector<HTMLElement>('.playerbar .info')!.getBoundingClientRect()
    const progress = document.querySelector<HTMLElement>('.playerbar .progress')!.getBoundingClientRect()
    return [quality, info, progress].map((rect) => rect.top + rect.height / 2)
  })
  expect(Math.max(...playerAlignment) - Math.min(...playerAlignment)).toBeLessThan(1)

  await page.locator('.flux-library-sensor').hover()
  await expect(page.locator('.flux-library-sheet')).not.toHaveAttribute('aria-hidden', 'true')
  const safePlayerLayout = await page.evaluate(() => {
    const library = document.querySelector<HTMLElement>('.flux-library-sheet')!.getBoundingClientRect()
    const player = document.querySelector<HTMLElement>('.playerbar')!.getBoundingClientRect()
    return { libraryBottom: library.bottom, playerTop: player.top }
  })
  expect(safePlayerLayout.libraryBottom).toBeLessThanOrEqual(safePlayerLayout.playerTop)

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

  await app.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows().find((window) => /FluxPlayer/i.test(window.getTitle()))
    mainWindow?.setSize(960, 720)
  })
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(960)
  await captureVisual(page, stageCanvas, testInfo, 'html-light-narrow')

  await page.getByRole('button', { name: '关闭', exact: true }).click()
  const exit = await electronHarness.waitForExit()
  expect(exit.signal).toBeNull()
  expect(exit.code).toBe(0)
})

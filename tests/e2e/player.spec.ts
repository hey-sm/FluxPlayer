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
  supportedQualities: ['lossless'],
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

async function resizeMainWindow(
  app: import('@playwright/test').ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<number> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const mainWindow = BrowserWindow.getAllWindows().find((window) => /FluxPlayer/i.test(window.getTitle()))
      mainWindow?.setSize(size.width, size.height)
    },
    { width, height },
  )
  return page.evaluate(() => window.innerWidth)
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
  test.setTimeout(90_000)
  const { app, page, rendererCrashes } = electronHarness
  await electronHarness.installMusicFixture({
    query: 'M6 E2E',
    track: TRACK,
    quality: 'E2E WAV',
  })

  await expect(page).toHaveURL(/^flux:\/\/app\//)
  await expect(page).toHaveTitle(/FluxPlayer/i)
  await expect(page.locator('[data-stage-background]')).toBeVisible()
  const stageCanvas = page.locator('[data-stage-background] canvas')
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
    const topbar = document.querySelector<HTMLElement>('[data-app-chrome="topbar"]')!
    const library = document.querySelector<HTMLElement>('[data-edge-sheet][data-side="left"]')!
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
  const hoverSensorLayout = await page.evaluate(() => {
    const panel = document
      .querySelector<HTMLElement>('[data-edge-sheet][data-side="left"]')!
      .getBoundingClientRect()
    const sensor = document
      .querySelector<HTMLElement>('[data-edge-sheet-sensor][data-side="left"]')!
      .getBoundingClientRect()
    return {
      panelWidth: panel.width,
      panelHeight: panel.height,
      sensorWidth: sensor.width,
      sensorHeight: sensor.height,
    }
  })
  expect(hoverSensorLayout.sensorWidth).toBeCloseTo(hoverSensorLayout.panelWidth / 2, 0)
  expect(hoverSensorLayout.sensorHeight).toBeCloseTo(hoverSensorLayout.panelHeight / 2, 0)
  await expect(page.locator('[data-edge-sheet][data-side="left"]')).toHaveAttribute(
    'data-animation-direction',
    'horizontal',
  )
  await expect(page.locator('[data-edge-sheet][data-side="left"]')).toHaveAttribute(
    'data-animation-reverse',
    'true',
  )
  await expect(page.locator('[data-edge-sheet][data-side="right"]')).toHaveAttribute(
    'data-animation-direction',
    'horizontal',
  )
  await expect(page.locator('[data-edge-sheet][data-side="right"]')).toHaveAttribute(
    'data-animation-reverse',
    'false',
  )
  const edgeGlassStyle = await page.evaluate(() => {
    const read = (side: 'left' | 'right') => {
      const element = document.querySelector<HTMLElement>(`[data-edge-sheet][data-side="${side}"]`)!
      const style = getComputedStyle(element)
      return {
        background: style.backgroundColor,
        backdropFilter: style.backdropFilter,
        boxShadow: style.boxShadow.replaceAll(' ', ''),
        borderRadius: [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ],
      }
    }
    const probe = document.createElement('div')
    probe.style.background = 'var(--saved-panel-glass-bg)'
    probe.style.backdropFilter = 'var(--saved-panel-glass-filter)'
    probe.style.boxShadow = 'var(--saved-panel-glass-shadow)'
    document.body.append(probe)
    const probeStyle = getComputedStyle(probe)
    const expected = {
      background: probeStyle.backgroundColor,
      backdropFilter: probeStyle.backdropFilter,
      boxShadow: probeStyle.boxShadow.replaceAll(' ', ''),
    }
    probe.remove()
    return { left: read('left'), right: read('right'), expected }
  })
  expect(edgeGlassStyle.left.borderRadius).toEqual(['0px', '15px', '15px', '0px'])
  expect(edgeGlassStyle.right.borderRadius).toEqual(['15px', '0px', '0px', '15px'])
  for (const side of [edgeGlassStyle.left, edgeGlassStyle.right]) {
    expect(side.background).toBe(edgeGlassStyle.expected.background)
    expect(side.backdropFilter).toBe(edgeGlassStyle.expected.backdropFilter)
    expect(side.boxShadow).toBe(edgeGlassStyle.expected.boxShadow)
  }
  await expect(page.locator('[data-search-motion]')).toHaveAttribute('data-animation-direction', 'vertical')
  await expect(page.locator('[data-search-motion]')).toHaveAttribute('data-animation-reverse', 'true')

  const settingsButton = page.getByRole('button', { name: '设置' })
  await settingsButton.click()
  const settingsDialog = page.locator('[data-dialog-motion-content]')
  await expect(settingsDialog).toHaveAttribute('data-state', 'open')
  await expect(page.getByRole('combobox', { name: '界面动效' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '音乐视觉' })).toHaveCount(0)
  const lyricsColorSwitch = page.getByRole('switch', { name: '歌词高亮色跟随主题' })
  await lyricsColorSwitch.focus()
  await page.keyboard.press('Space')
  await expect(lyricsColorSwitch).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Space')
  await expect(lyricsColorSwitch).toHaveAttribute('aria-checked', 'true')
  const backgroundSelect = page.getByRole('combobox', { name: '动态背景' })
  await expect(backgroundSelect).toContainText('光线')
  await backgroundSelect.click()
  await expect(page.locator('[data-glass-select-content] .flux-liquid-glass')).toBeVisible()
  await expect(page.getByRole('option', { name: '星河' })).toHaveCount(0)
  await page.getByRole('option', { name: '吊灯' }).click()
  await expect(backgroundSelect).toContainText('吊灯')
  await expect(page.locator('[data-app-root]')).toHaveAttribute('data-background-mode', 'dynamic')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fluxplayer-dynamic-background-v1')))
    .toBe('html-light')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fluxplayer-background-mode-v1')))
    .toBe('dynamic')
  await expect(page.locator('[data-stage-background] canvas')).toHaveCount(1)
  await page.getByRole('button', { name: '关闭' }).click()
  await expect(settingsDialog).toHaveCount(0)
  await expect(settingsButton).toBeFocused()
  await settingsButton.click()
  await expect(settingsDialog).toHaveAttribute('data-state', 'open')
  await page.keyboard.press('Escape')
  await expect(settingsDialog).toHaveCount(0)
  await expect(settingsButton).toBeFocused()
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

  const searchSensor = page.locator('[data-search-sensor]')
  const searchShell = page.locator('[data-search-shell]')
  const searchInput = page.getByPlaceholder(/搜索歌曲/)
  await expect(searchInput).not.toBeVisible()

  await searchSensor.hover()
  await expect(searchShell).toHaveAttribute('data-visible', 'true')
  await expect(searchInput).toBeVisible()
  await searchInput.fill('M6 E2E')
  const searchResults = page.getByRole('region', { name: '搜索结果' })
  const song = searchResults.getByText(TRACK.name, { exact: true })
  await expect(song).toBeVisible()

  await searchResults.hover()
  await expect(searchShell).toHaveAttribute('data-visible', 'true')
  await expect(searchResults).toBeVisible()

  await searchInput.evaluate((input) => input.blur())
  await page.mouse.move(1, Math.floor((page.viewportSize()?.height ?? 720) / 2))
  await expect(searchShell).not.toHaveAttribute('data-visible', 'true')
  await expect(searchInput).not.toBeVisible()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await searchSensor.hover()
  await expect
    .poll(() =>
      page.locator('[data-search-motion]').evaluate((element) => ({
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
  await expect(page.locator('[data-edge-sheet][data-side="left"]')).toHaveAttribute('aria-hidden', 'true')
  await expect(page.getByText('音质：E2E WAV', { exact: true })).toHaveCount(0)
  const qualityTrigger = page.getByRole('combobox', { name: '选择播放音质' })
  await expect(qualityTrigger).toHaveText('无损')
  await expect(qualityTrigger.locator('[data-glass-select-chevron]')).toBeHidden()
  const qualityTriggerStyle = await qualityTrigger.evaluate((trigger) => {
    const style = getComputedStyle(trigger)
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      hasVisibleBoxShadow:
        style.boxShadow !== 'none' && /(?:rgb|#)/.test(style.boxShadow.replaceAll('rgba(0, 0, 0, 0)', '')),
    }
  })
  expect(qualityTriggerStyle).toEqual({
    backgroundColor: 'rgba(0, 0, 0, 0)',
    borderTopWidth: '0px',
    hasVisibleBoxShadow: false,
  })
  await qualityTrigger.click()
  const qualityOptions = page.locator('[data-glass-select-content] [role="option"]')
  await expect(qualityOptions).toHaveCount(5)
  await expect(qualityOptions).toContainText(['臻品', 'Hi-Res', '无损', '极高', '标准'])
  const currentQualityOption = qualityOptions.filter({ hasText: '无损' })
  await expect(currentQualityOption).toContainText('当前')
  await expect(page.locator('[data-glass-select-content] [role="option"][data-state="checked"]')).toHaveCount(
    1,
  )
  await page.keyboard.press('Escape')
  await expect(qualityTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('[data-glass-select-content]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible()
  const playerAlignment = await page.evaluate(() => {
    const quality = document
      .querySelector<HTMLElement>('[data-glass-select-trigger][aria-label="选择播放音质"]')!
      .getBoundingClientRect()
    const info = document.querySelector<HTMLElement>('[data-player-info]')!.getBoundingClientRect()
    const progress = document.querySelector<HTMLElement>('[data-player-progress]')!.getBoundingClientRect()
    return [quality, info, progress].map((rect) => rect.top + rect.height / 2)
  })
  expect(Math.max(...playerAlignment) - Math.min(...playerAlignment)).toBeLessThan(1)

  await page.locator('[data-edge-sheet-sensor][data-side="left"]').hover()
  await expect(page.locator('[data-edge-sheet][data-side="left"]')).not.toHaveAttribute('aria-hidden', 'true')
  const safePlayerLayout = await page.evaluate(() => {
    const library = document
      .querySelector<HTMLElement>('[data-edge-sheet][data-side="left"]')!
      .getBoundingClientRect()
    const player = document.querySelector<HTMLElement>('[data-playerbar]')!.getBoundingClientRect()
    return { libraryBottom: library.bottom, playerTop: player.top, playerWidth: player.width }
  })
  expect(safePlayerLayout.libraryBottom).toBeLessThanOrEqual(safePlayerLayout.playerTop)
  expect(safePlayerLayout.playerWidth).toBeLessThanOrEqual(861)

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

  await page.evaluate(() => {
    const audio = (
      globalThis as typeof globalThis & { __fluxE2EAudioElements?: HTMLAudioElement[] }
    ).__fluxE2EAudioElements?.at(-1)
    if (audio) audio.currentTime = 1
  })
  await expect.poll(async () => (await inspectTrackedAudio(page)).currentTime).toBeGreaterThanOrEqual(0.9)
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })))
  await expect.poll(async () => (await inspectTrackedAudio(page)).currentTime).toBeGreaterThanOrEqual(5.8)
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })))
  await expect.poll(async () => (await inspectTrackedAudio(page)).currentTime).toBeLessThan(1.5)

  const playbackCallsBeforeTrackKeys = (await electronHarness.musicCalls()).filter(
    (call) => call.channel === 'flux:music:resolve-playback',
  ).length
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })))
  await expect
    .poll(
      async () =>
        (await electronHarness.musicCalls()).filter((call) => call.channel === 'flux:music:resolve-playback')
          .length,
    )
    .toBe(playbackCallsBeforeTrackKeys + 1)
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })))
  await expect
    .poll(
      async () =>
        (await electronHarness.musicCalls()).filter((call) => call.channel === 'flux:music:resolve-playback')
          .length,
    )
    .toBe(playbackCallsBeforeTrackKeys + 2)

  const musicCalls = await electronHarness.musicCalls()
  expect(
    musicCalls.filter((call) => call.channel === 'flux:music:search').map((call) => call.payload),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ provider: 'netease', keywords: 'M6 E2E' }),
      expect.objectContaining({ provider: 'qq', keywords: 'M6 E2E' }),
    ]),
  )
  expect(musicCalls.filter((call) => call.channel === 'flux:music:resolve-playback')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({
          song: expect.objectContaining({ provider: 'netease', id: TRACK.id }),
        }),
      }),
    ]),
  )
  expect(rendererCrashes).toEqual([])
  await expect(qualityTrigger).toHaveAttribute('aria-expanded', 'false')

  await page.getByRole('button', { name: '沉浸全屏' }).click()
  await expect(page.locator('[data-app-root]')).toHaveAttribute('data-focus-mode', 'true')
  await expect(page.locator('[data-app-chrome="topbar"]')).toBeHidden()
  await expect(page.locator('[data-app-chrome="content"]')).toBeHidden()
  await expect(page.locator('[data-edge-sheet][data-side="left"]')).toBeHidden()
  await expect(page.locator('[data-edge-sheet][data-side="right"]')).toBeHidden()
  await expect(page.locator('[data-edge-sheet-sensor][data-side="left"]')).toBeHidden()
  await expect(page.locator('[data-edge-sheet-sensor][data-side="right"]')).toBeHidden()
  await expect(page.locator('[data-focus-exit-zone]')).toHaveCount(2)
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (window) => /FluxPlayer/i.test(window.getTitle()) && window.isFullScreen(),
        ),
      ),
    )
    .toBe(true)
  const leftExitZone = page.locator('[data-focus-exit-zone][data-side="left"]')
  await leftExitZone.hover()
  await expect
    .poll(() => leftExitZone.locator('button').evaluate((button) => getComputedStyle(button).opacity))
    .toBe('1')
  const focusExitLayout = await page.locator('[data-focus-exit-zone]').evaluateAll((zones) => {
    const [left, right] = zones.map((zone) => zone.getBoundingClientRect())
    return { gap: right.left - left.right, viewportWidth: window.innerWidth }
  })
  expect(focusExitLayout.gap).toBeGreaterThan(focusExitLayout.viewportWidth * 0.4)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-app-root]')).not.toHaveAttribute('data-focus-mode', 'true')
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (window) => /FluxPlayer/i.test(window.getTitle()) && window.isFullScreen(),
        ),
      ),
    )
    .toBe(false)

  // The window control must label its own next action, not the state it is already in.
  const enterFullscreen = page.getByRole('button', { name: '全屏', exact: true })
  const leaveFullscreen = page.getByRole('button', { name: '恢复', exact: true })
  await enterFullscreen.click()
  await expect(leaveFullscreen).toBeVisible()
  await expect(enterFullscreen).toHaveCount(0)
  await leaveFullscreen.click()
  await expect(enterFullscreen).toBeVisible()
  await expect(leaveFullscreen).toHaveCount(0)

  // Retry the resize: a setSize() that lands while the window is still leaving fullscreen is dropped.
  await expect.poll(() => resizeMainWindow(app, page, 960, 720)).toBeLessThanOrEqual(960)
  await captureVisual(page, stageCanvas, testInfo, 'html-light-narrow')

  await page.getByRole('button', { name: '设置' }).click()
  await backgroundSelect.click()
  await page.getByRole('option', { name: '星系' }).click()
  await expect(backgroundSelect).toContainText('星系')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fluxplayer-dynamic-background-v1')))
    .toBe('galaxy')
  await page.getByRole('button', { name: '关闭' }).click()
  await captureVisual(page, stageCanvas, testInfo, 'galaxy-narrow')

  await expect.poll(() => resizeMainWindow(app, page, 1280, 720)).toBeGreaterThan(960)
  await captureVisual(page, stageCanvas, testInfo, 'galaxy-wide')
  expect(rendererCrashes).toEqual([])

  await page.getByRole('button', { name: '关闭', exact: true }).click()
  const exit = await electronHarness.waitForExit()
  expect(exit.signal).toBeNull()
  expect(exit.code).toBe(0)
})

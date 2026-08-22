import sharp from 'sharp'
import type { Locator, Page, TestInfo } from '@playwright/test'
import type { UnifiedSong } from '../../src/shared/models'
import { E2E_AUDIO_URL, expect, test } from './electron.fixture'

const TRACK: UnifiedSong = {
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
  supportedQualities: ['jymaster', 'hires', 'lossless', 'exhigh', 'standard'],
}

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
  await captureVisual(page, stageCanvas, testInfo, 'rain-desktop')
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
  await expect(page.locator('[data-edge-sheet][data-side="left"]')).toHaveAttribute(
    'data-animation-effect',
    'live-clip-reveal',
  )
  await expect(page.locator('[data-edge-sheet][data-side="right"]')).toHaveAttribute(
    'data-animation-direction',
    'horizontal',
  )
  await expect(page.locator('[data-edge-sheet][data-side="right"]')).toHaveAttribute(
    'data-animation-reverse',
    'false',
  )
  await expect(page.locator('[data-edge-sheet][data-side="right"]')).toHaveAttribute(
    'data-animation-effect',
    'live-clip-reveal',
  )
  const edgeGlassStyle = await page.evaluate(async () => {
    const readSheet = (side: 'left' | 'right') => {
      const sheet = document.querySelector<HTMLElement>(`[data-edge-sheet][data-side="${side}"]`)!
      const surface = sheet.querySelector<HTMLElement>('[data-flux-glass-surface]')!
      const card = surface.querySelector<HTMLElement>('.glass-ui-container')!
      const border = card.querySelector<HTMLElement>('.glass-ui-border-layer')!
      const distortion = card.querySelector<HTMLElement>('.glass-ui-distortion-layer')!
      const displacement = card.querySelector<SVGFEDisplacementMapElement>('feDisplacementMap')!
      return {
        config: surface.dataset.glassConfig,
        surfaceBackground: getComputedStyle(surface).backgroundColor,
        surfaceOverflow: getComputedStyle(surface).overflow,
        sheetTransform: getComputedStyle(sheet).transform,
        cardRadius: getComputedStyle(card).borderRadius,
        cardTransform: getComputedStyle(card).transform,
        borderWidth: Number.parseFloat(getComputedStyle(border).borderTopWidth),
        borderColor: getComputedStyle(border).borderTopColor,
        borderOpacity: getComputedStyle(border).opacity,
        backdropFilter: getComputedStyle(sheet).backdropFilter,
        childBackdropFilter: getComputedStyle(distortion).backdropFilter,
        displacement: displacement.getAttribute('scale'),
        hasSvgFilter: Boolean(card.querySelector('svg filter')),
      }
    }
    const card = document.querySelector<HTMLElement>(
      '[data-edge-sheet][data-side="left"] .glass-ui-container',
    )!
    const hoverStyleBefore = {
      transition: card.style.transition,
      willChange: card.style.willChange,
    }
    for (let index = 0; index < 8; index += 1) {
      card.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 80 + index * 4,
          clientY: 180 + index * 3,
        }),
      )
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    const hoverStyleAfter = {
      transition: card.style.transition,
      willChange: card.style.willChange,
    }
    return {
      left: readSheet('left'),
      right: readSheet('right'),
      hoverStyleBefore,
      hoverStyleAfter,
    }
  })
  expect(edgeGlassStyle.left.config).toBe(edgeGlassStyle.right.config)
  for (const sheet of [edgeGlassStyle.left, edgeGlassStyle.right]) {
    expect(sheet).toEqual(
      expect.objectContaining({
        surfaceBackground: 'rgba(0, 0, 0, 0)',
        surfaceOverflow: 'visible',
        sheetTransform: 'none',
        cardRadius: '20px',
        cardTransform: 'none',
        borderColor: 'rgb(255, 255, 255)',
        borderOpacity: '0',
        backdropFilter: 'blur(10px) saturate(1) brightness(1)',
        childBackdropFilter: 'none',
        displacement: '50',
        hasSvgFilter: true,
      }),
    )
    expect(sheet.borderWidth).toBeGreaterThan(0)
  }
  expect(edgeGlassStyle.hoverStyleBefore).toEqual({ transition: '', willChange: '' })
  expect(edgeGlassStyle.hoverStyleAfter).toEqual({ transition: '', willChange: '' })
  await expect(page.locator('[data-search-motion]')).toHaveAttribute('data-animation-direction', 'vertical')
  await expect(page.locator('[data-search-motion]')).toHaveAttribute('data-animation-reverse', 'true')

  const settingsButton = page.getByRole('button', { name: '设置' })
  await settingsButton.click()
  const settingsDialog = page.locator('[data-dialog-motion-content]')
  await expect(settingsDialog).toHaveAttribute('data-state', 'open')
  await expect(page.getByRole('combobox', { name: '界面动效' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '音乐视觉' })).toHaveCount(0)
  await page.getByRole('tab', { name: '歌词', exact: true }).click()
  const lyricsColorSwitch = page.getByRole('switch', { name: '歌词高亮色跟随主题' })
  await lyricsColorSwitch.focus()
  await page.keyboard.press('Space')
  await expect(lyricsColorSwitch).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Space')
  await expect(lyricsColorSwitch).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('tab', { name: '背景', exact: true }).click()
  const backgroundSelect = page.getByRole('combobox', { name: '动态背景' })
  await expect(backgroundSelect).toContainText('雨窗')
  await backgroundSelect.click()
  await expect(page.locator('[data-glass-select-surface]')).toBeVisible()
  await expect(page.getByRole('option', { name: '星河' })).toHaveCount(0)
  await expect(page.getByRole('option', { name: '光线' })).toHaveCount(0)
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
  await settingsButton.click()
  await expect(settingsDialog).toHaveAttribute('data-state', 'open')
  await page.keyboard.press('Escape')
  await expect(settingsDialog).toHaveCount(0)
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
    .toEqual({ opacity: '1', transform: 'none' })
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

  await page.evaluate(() => {
    const style = document.createElement('style')
    style.dataset.glassMotionPixelFixture = ''
    style.textContent = `
      [data-app-root] {
        background: repeating-conic-gradient(#20242c 0 25%, #0b0d12 0 50%) 0 0 / 18px 18px !important;
      }
      [data-stage-background], [data-wallpaper-engine-layer] {
        visibility: hidden !important;
      }
    `
    document.head.append(style)
  })
  await page.locator('[data-edge-sheet-sensor][data-side="left"]').hover()
  const librarySheet = page.locator('[data-edge-sheet][data-side="left"]')
  await expect(librarySheet).not.toHaveAttribute('aria-hidden', 'true')
  await expect(librarySheet).toHaveAttribute('data-animation-state', 'enter')
  expect(
    await page.evaluate(() =>
      document.getAnimations().some((animation) => {
        const effect = animation.effect
        return (
          effect instanceof KeyframeEffect &&
          /flux-(?:library|detail)-panel-vt/.test(effect.pseudoElement ?? '')
        )
      }),
    ),
  ).toBe(false)
  const libraryBackgroundDuringMotion = await page.screenshot({
    clip: { x: 420, y: 100, width: 500, height: 400 },
  })
  const libraryClipTimeline = await librarySheet.evaluate(async (element) => {
    const read = () => {
      const style = getComputedStyle(element)
      return {
        transform: style.transform,
        clipPath: style.clipPath,
        visibility: style.visibility,
        glassTransform: getComputedStyle(element.querySelector<HTMLElement>('.glass-ui-container')!)
          .transform,
        backdropFilter: style.backdropFilter,
      }
    }
    const start = read()
    await new Promise((resolve) => setTimeout(resolve, 80))
    const middle = read()
    return { start, middle }
  })
  expect(libraryClipTimeline.start.clipPath).not.toBe(libraryClipTimeline.middle.clipPath)
  for (const frame of Object.values(libraryClipTimeline)) {
    expect(frame.transform).toBe('none')
    expect(frame.glassTransform).toBe('none')
    expect(frame.backdropFilter).toContain('blur(10px)')
  }
  await expect(librarySheet).not.toHaveAttribute('data-animation-state')
  const libraryBackgroundAtRest = await page.screenshot({
    clip: { x: 420, y: 100, width: 500, height: 400 },
  })
  await page.evaluate(() => document.querySelector('[data-glass-motion-pixel-fixture]')?.remove())
  expect(await imageDelta(libraryBackgroundDuringMotion, libraryBackgroundAtRest)).toBeLessThan(4)
  const libraryRestingStyle = await librarySheet.evaluate((element) => ({
    transform: getComputedStyle(element).transform,
    glassTransform: getComputedStyle(element.querySelector<HTMLElement>('.glass-ui-container')!).transform,
  }))
  expect(libraryRestingStyle).toEqual({ transform: 'none', glassTransform: 'none' })

  const libraryStructure = await librarySheet.evaluate((sheet) => {
    const surface = sheet.querySelector<HTMLElement>('[data-flux-glass-surface]')!
    const card = surface.querySelector<HTMLElement>('.glass-ui-container')!
    const content = card.querySelector<HTMLElement>('.glass-ui-card-content')!
    const panel = content.querySelector<HTMLElement>('[data-library-panel]')!
    const cardRect = card.getBoundingClientRect()
    const contentRect = content.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    return {
      sheetChildCount: sheet.children.length,
      surfaceIsDirectChild: sheet.firstElementChild === surface,
      cardIsDirectChild: surface.firstElementChild === card,
      panelIsDirectChild: content.firstElementChild === panel,
      bottomDelta: Math.max(
        Math.abs(cardRect.bottom - contentRect.bottom),
        Math.abs(contentRect.bottom - panelRect.bottom),
      ),
      listGradientCount: panel.querySelectorAll('[data-animated-list-gradient]').length,
    }
  })
  expect(libraryStructure).toEqual({
    sheetChildCount: 1,
    surfaceIsDirectChild: true,
    cardIsDirectChild: true,
    panelIsDirectChild: true,
    bottomDelta: expect.any(Number),
    listGradientCount: 0,
  })
  expect(libraryStructure.bottomDelta).toBeLessThan(1)

  const safePlayerLayout = await page.evaluate(() => {
    const library = document
      .querySelector<HTMLElement>('[data-edge-sheet][data-side="left"]')!
      .getBoundingClientRect()
    const player = document.querySelector<HTMLElement>('[data-playerbar]')!.getBoundingClientRect()
    return { libraryBottom: library.bottom, playerTop: player.top, playerWidth: player.width }
  })
  expect(safePlayerLayout.libraryBottom).toBeLessThanOrEqual(safePlayerLayout.playerTop)
  expect(safePlayerLayout.playerWidth).toBeLessThanOrEqual(861)

  const playerStyle = await page.locator('[data-playerbar]').evaluate((player) => {
    const readStyle = () => {
      const style = getComputedStyle(player)
      return {
        radius: style.borderRadius,
        borderColor: style.borderColor,
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        backdropFilter: style.backdropFilter,
        classic: player.classList.contains('classic-control-glass'),
        filterSvg: Boolean(player.querySelector('.control-glass-filter-svg')),
        filter: Boolean(
          player.querySelector('.control-glass-filter-svg filter#mineradio-control-glass-filter'),
        ),
      }
    }
    const before = readStyle()
    const root = document.documentElement
    const previousGlassValues = {
      radius: root.style.getPropertyValue('--flux-glass-radius'),
      borderOpacity: root.style.getPropertyValue('--flux-glass-border-opacity'),
      backgroundOpacity: root.style.getPropertyValue('--flux-glass-bg-opacity'),
    }
    root.style.setProperty('--flux-glass-radius', '60px')
    root.style.setProperty('--flux-glass-border-opacity', '1')
    root.style.setProperty('--flux-glass-bg-opacity', '1')
    const after = readStyle()
    root.style.setProperty('--flux-glass-radius', previousGlassValues.radius)
    root.style.setProperty('--flux-glass-border-opacity', previousGlassValues.borderOpacity)
    root.style.setProperty('--flux-glass-bg-opacity', previousGlassValues.backgroundOpacity)
    return {
      before,
      after,
      hasGlobalGlassSurface: player.hasAttribute('data-flux-glass-surface'),
      hasGlassLayers: Boolean(player.querySelector('.glass-ui-container')),
    }
  })
  expect(playerStyle.hasGlobalGlassSurface).toBe(false)
  expect(playerStyle.hasGlassLayers).toBe(false)
  expect(playerStyle.before).toEqual(playerStyle.after)
  expect(playerStyle.before).toEqual(
    expect.objectContaining({ radius: '50px', classic: true, filterSvg: true, filter: true }),
  )
  expect(playerStyle.before.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(playerStyle.before.boxShadow).not.toBe('none')
  await page.locator('[data-playerbar]').screenshot({ path: testInfo.outputPath('player-restored.png') })

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
      page.evaluate(async () => (await window.fluxDesktop?.getWindowState())?.isFullScreen ?? false),
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
      page.evaluate(async () => (await window.fluxDesktop?.getWindowState())?.isFullScreen ?? false),
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
  // Chromium can round the minimum content width up by one CSS pixel under
  // the host display scale (960 outer pixels -> 961 inner pixels).
  await expect.poll(() => resizeMainWindow(app, page, 960, 720)).toBeLessThanOrEqual(961)
  await captureVisual(page, stageCanvas, testInfo, 'html-light-narrow')

  await page.getByRole('button', { name: '设置' }).click()
  await backgroundSelect.click()
  await page.getByRole('option', { name: '水纹' }).click()
  await expect(backgroundSelect).toContainText('水纹')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fluxplayer-dynamic-background-v1')))
    .toBe('caustic')
  await page.getByRole('button', { name: '关闭' }).click()
  await captureVisual(page, stageCanvas, testInfo, 'caustic-narrow')

  await expect.poll(() => resizeMainWindow(app, page, 1280, 720)).toBeGreaterThan(960)
  await captureVisual(page, stageCanvas, testInfo, 'caustic-wide')
  expect(rendererCrashes).toEqual([])

  await page.getByRole('button', { name: '关闭', exact: true }).click()
  const exit = await electronHarness.waitForExit()
  expect(exit.signal).toBeNull()
  expect(exit.code).toBe(0)
})

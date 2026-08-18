import type { CDPSession } from '@playwright/test'
import sharp from 'sharp'
import type { UnifiedSong } from '../../src/shared/models'
import { expect, test } from './electron.fixture'

const BASE_TRACK: UnifiedSong = {
  provider: 'netease',
  type: 'song',
  id: 63_000_000,
  name: 'Renderer migration probe',
  artist: 'FluxPlayer E2E',
  artists: [{ id: 63_100_000, name: 'FluxPlayer E2E' }],
  album: 'Migration acceptance',
  cover: '',
  duration: 180_000,
  fee: 0,
  playable: true,
  supportedQualities: ['lossless'],
}

const LONG_TRACKS: UnifiedSong[] = Array.from({ length: 160 }, (_, index) => ({
  ...BASE_TRACK,
  id: Number(BASE_TRACK.id) + index,
  name: `迁移长列表曲目 ${String(index + 1).padStart(3, '0')}`,
  artists: BASE_TRACK.artists.map((artist) => ({ ...artist })),
}))

async function metric(session: CDPSession, name: string): Promise<number> {
  const result = await session.send('Performance.getMetrics')
  return result.metrics.find((item) => item.name === name)?.value ?? 0
}

async function pixelEdgeEnergy(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let total = 0
  let samples = 0
  const { channels, height, width } = info

  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const offset = (y * width + x) * channels
      const left = offset - channels
      const above = offset - width * channels
      for (let channel = 0; channel < Math.min(channels, 3); channel += 1) {
        total += Math.abs(data[offset + channel] - data[left + channel])
        total += Math.abs(data[offset + channel] - data[above + channel])
        samples += 2
      }
    }
  }

  return samples ? total / samples : 0
}

test('Renderer 样式迁移最终交互、长列表与布局性能验收', async ({ electronHarness }, testInfo) => {
  test.setTimeout(60_000)
  const { app, page, rendererCrashes } = electronHarness
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))

  await electronHarness.installMusicFixture({ query: 'renderer migration', track: BASE_TRACK })
  await page.evaluate((tracks) => {
    localStorage.setItem(
      'fluxplayer.library.recent.v1:netease:guest',
      JSON.stringify({
        version: 1,
        entries: tracks.map((track, index) => ({ track, playedAt: Date.now() - index * 1000 })),
      }),
    )
  }, LONG_TRACKS)
  await page.reload({ waitUntil: 'domcontentloaded' })

  const leftPanel = page.locator('[data-edge-sheet][data-side="left"]')
  const rightPanel = page.locator('[data-edge-sheet][data-side="right"]')
  const rightSensor = page.locator('[data-edge-sheet-sensor][data-side="right"]')

  await expect(leftPanel).not.toHaveAttribute('aria-hidden', 'true')
  const recentButton = page.getByRole('button', { name: /最近播放/ })
  await expect(recentButton).toBeEnabled()
  await recentButton.click()
  await expect(rightPanel).not.toHaveAttribute('aria-hidden', 'true')
  await expect(rightPanel).not.toHaveAttribute('data-animation-state')

  const edgeStyles = await page.evaluate(() => {
    const read = (side: 'left' | 'right') => {
      const element = document.querySelector<HTMLElement>(
        `[data-edge-sheet][data-side="${side}"] [data-flux-glass-surface]`,
      )!
      const card = element.querySelector<HTMLElement>('.glass-ui-container')!
      const distortion = card.querySelector<HTMLElement>('.glass-ui-distortion-layer')!
      const surfaceRect = element.getBoundingClientRect()
      const cardRect = card.getBoundingClientRect()
      return {
        config: element.dataset.glassConfig,
        backdropFilter: getComputedStyle(element.closest<HTMLElement>('[data-edge-sheet]')!).backdropFilter,
        childBackdropFilter: getComputedStyle(distortion).backdropFilter,
        viewTransitionName: getComputedStyle(
          element.closest<HTMLElement>('[data-edge-sheet]')!,
        ).getPropertyValue('view-transition-name'),
        cardRadius: getComputedStyle(card).borderRadius,
        surfaceLeft: surfaceRect.left,
        surfaceRight: surfaceRect.right,
        cardLeft: cardRect.left,
        cardRight: cardRect.right,
      }
    }
    return { left: read('left'), right: read('right') }
  })
  expect(edgeStyles.left.config).toBe(edgeStyles.right.config)
  expect(edgeStyles.left.backdropFilter).toContain('blur(10px)')
  expect(edgeStyles.right.backdropFilter).toContain('blur(10px)')
  expect(edgeStyles.left.childBackdropFilter).toBe('none')
  expect(edgeStyles.right.childBackdropFilter).toBe('none')
  expect(edgeStyles.left.viewTransitionName).toBe('none')
  expect(edgeStyles.right.viewTransitionName).toBe('none')
  expect(edgeStyles.left.cardRadius).toBe('30px')
  expect(edgeStyles.right.cardRadius).toBe('30px')
  expect(edgeStyles.left.cardLeft).toBeLessThanOrEqual(edgeStyles.left.surfaceLeft - 29)
  expect(edgeStyles.left.cardRight).toBeCloseTo(edgeStyles.left.surfaceRight, 0)
  expect(edgeStyles.right.cardLeft).toBeCloseTo(edgeStyles.right.surfaceLeft, 0)
  expect(edgeStyles.right.cardRight).toBeGreaterThanOrEqual(edgeStyles.right.surfaceRight + 29)

  const originalEdgeBackdrop = await leftPanel.evaluate((element: HTMLElement) =>
    element.style.getPropertyValue('backdrop-filter'),
  )
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.dataset.edgeGlassPixelFixture = ''
    style.textContent = `
      [data-app-root] {
        background: repeating-conic-gradient(#f8f8f8 0 25%, #101010 0 50%) 0 0 / 12px 12px !important;
      }
      [data-stage-background],
      [data-wallpaper-engine-layer],
      [data-edge-sheet][data-side='left'] .glass-ui-card-content > * {
        visibility: hidden !important;
      }
    `
    document.head.append(style)
  })
  let clearEdgeGlass: Buffer
  let blurredEdgeGlass: Buffer
  try {
    const bounds = await leftPanel.boundingBox()
    if (!bounds) throw new Error('Left edge glass bounds are unavailable')
    const clip = {
      x: bounds.x + 32,
      y: bounds.y + 32,
      width: Math.min(240, bounds.width - 64),
      height: Math.min(300, bounds.height - 64),
    }
    await leftPanel.evaluate((element: HTMLElement) => {
      element.style.backdropFilter = 'none'
    })
    clearEdgeGlass = await page.screenshot({ clip })
    await leftPanel.evaluate((element: HTMLElement, value) => {
      element.style.backdropFilter = value
    }, originalEdgeBackdrop)
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    blurredEdgeGlass = await page.screenshot({ clip })
  } finally {
    await leftPanel.evaluate((element: HTMLElement, value) => {
      element.style.backdropFilter = value
    }, originalEdgeBackdrop)
    await page.evaluate(() => document.querySelector('[data-edge-glass-pixel-fixture]')?.remove())
  }
  expect(await pixelEdgeEnergy(clearEdgeGlass)).toBeGreaterThan(
    (await pixelEdgeEnergy(blurredEdgeGlass)) * 1.8,
  )

  // Leaving an available sheet must preserve it before the established two-second deadline.
  await rightPanel.hover()
  await page.mouse.move(640, 680)
  await page.waitForTimeout(1_600)
  await expect(rightPanel).not.toHaveAttribute('aria-hidden', 'true')
  await expect(rightPanel).toHaveAttribute('aria-hidden', 'true', { timeout: 1_200 })
  await rightSensor.hover()
  await expect(rightPanel).not.toHaveAttribute('aria-hidden', 'true')

  // A low-height Electron window keeps both sheets between the top bar and player safe area.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => /FluxPlayer/i.test(candidate.getTitle()))
    window?.setSize(960, 500)
  })
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThanOrEqual(541)
  const compactLayout = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-edge-sheet][data-side="right"]')!
    const sensor = document.querySelector<HTMLElement>('[data-edge-sheet-sensor][data-side="right"]')!
    const panelRect = panel.getBoundingClientRect()
    const sensorRect = sensor.getBoundingClientRect()
    return {
      panelTop: panelRect.top,
      panelBottomGap: window.innerHeight - panelRect.bottom,
      panelHeight: panelRect.height,
      sensorHeight: sensorRect.height,
    }
  })
  expect(compactLayout.panelTop).toBeCloseTo(48, 0)
  expect(compactLayout.panelBottomGap).toBeCloseTo(88, 0)
  expect(compactLayout.panelHeight).toBeGreaterThan(300)
  expect(compactLayout.sensorHeight).toBeGreaterThanOrEqual(44)

  // The 160-row recent playlist remains scrollable and scrolling does not trigger sustained layout work.
  const longList = rightPanel.locator('[data-scroll-region]')
  await expect(longList).toBeVisible()
  await expect
    .poll(() =>
      longList.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      })),
    )
    .toEqual(
      expect.objectContaining({
        clientHeight: expect.any(Number),
        scrollHeight: expect.any(Number),
      }),
    )
  const dimensions = await longList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight * 4)

  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  const layoutBefore = await metric(session, 'LayoutCount')
  const styleBefore = await metric(session, 'RecalcStyleCount')
  await longList.evaluate(async (element) => {
    const maximum = element.scrollHeight - element.clientHeight
    for (let step = 0; step <= 24; step += 1) {
      element.scrollTop = (maximum * step) / 24
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  })
  const layoutAfter = await metric(session, 'LayoutCount')
  const styleAfter = await metric(session, 'RecalcStyleCount')
  const scrollFrameCount = 25
  expect((layoutAfter - layoutBefore) / scrollFrameCount).toBeLessThan(12)
  expect((styleAfter - styleBefore) / scrollFrameCount).toBeLessThan(16)
  expect(await rightPanel.locator('[data-animated-list-item]').count()).toBeLessThan(24)
  const rowBorderWidths = await rightPanel
    .locator('[data-animated-list-item]')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element)
      return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
    })
  expect(rowBorderWidths).toEqual(['0px', '0px', '0px', '0px'])
  await expect
    .poll(() => longList.evaluate((element) => element.scrollTop + element.clientHeight))
    .toBeGreaterThanOrEqual(dimensions.scrollHeight - 2)

  const idleLayoutBefore = await metric(session, 'LayoutCount')
  await page.waitForTimeout(600)
  const idleLayoutAfter = await metric(session, 'LayoutCount')
  expect(idleLayoutAfter - idleLayoutBefore).toBeLessThanOrEqual(5)
  await session.detach()

  // Reduced motion and rapid interruption both settle on a fully visible, identity transform.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect
    .poll(() =>
      rightPanel.evaluate((element) => ({
        opacity: getComputedStyle(element).opacity,
        transform: getComputedStyle(element).transform,
      })),
    )
    .toEqual({ opacity: '1', transform: 'none' })
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  const searchSensor = page.locator('[data-search-sensor]')
  const searchShell = page.locator('[data-search-shell]')
  await searchSensor.hover()
  await expect(searchShell).toHaveAttribute('data-visible', 'true')
  await page.mouse.move(4, 480)
  await searchSensor.hover()
  await expect(searchShell).toHaveAttribute('data-visible', 'true')
  await expect
    .poll(() =>
      page.locator('[data-search-motion]').evaluate((element) => ({
        opacity: getComputedStyle(element).opacity,
        transform: getComputedStyle(element).transform,
      })),
    )
    .toEqual({ opacity: '1', transform: 'none' })

  const searchInput = page.getByPlaceholder('搜索歌曲 / 歌手')
  await searchInput.fill('renderer migration')
  const searchPopover = page.locator('[data-search-popover]')
  await expect(searchPopover).toBeVisible()
  const searchPopoverGlass = await searchPopover.evaluate((surface) => {
    const config = JSON.parse(surface.dataset.glassConfig || '{}') as { blur?: number }
    const distortion = surface.querySelector<HTMLElement>('.glass-ui-distortion-layer')
    return {
      blur: config.blur,
      backdropFilter: distortion ? getComputedStyle(distortion).backdropFilter : '',
    }
  })
  expect(searchPopoverGlass.blur).toBe(10)
  expect(searchPopoverGlass.backdropFilter).toContain('blur(10px)')
  await page.keyboard.press('Escape')

  const settingsButton = page.getByRole('button', { name: '设置', exact: true })
  await settingsButton.evaluate((button: HTMLButtonElement) => button.click())
  await expect.poll(() => pageErrors).toEqual([])
  const dialog = page.locator('[data-dialog-motion-content]')
  await expect(dialog).toHaveAttribute('data-state', 'open')
  const stableSettingsSize = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  await testInfo.attach('settings-theme', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  })
  const glassTab = page.getByRole('tab', { name: '玻璃', exact: true })
  await glassTab.click()
  const blurSlider = page.getByRole('slider', { name: '模糊', exact: true })
  await blurSlider.focus()
  await blurSlider.press('Home')
  await expect.poll(() => blurSlider.getAttribute('aria-valuenow')).toBe('0')

  const captureSettingsBackdrop = async (): Promise<Buffer> => {
    await page.evaluate(() => {
      const style = document.createElement('style')
      style.dataset.glassPixelFixture = ''
      style.textContent = `
        [data-app-root] {
          background: repeating-conic-gradient(#f8f8f8 0 25%, #101010 0 50%) 0 0 / 12px 12px !important;
        }
        [data-app-root] > *,
        [data-settings-panel] .glass-ui-card-content > *,
        [data-settings-dialog] > button {
          visibility: hidden !important;
        }
        [data-dialog-motion-overlay] {
          background: rgb(0 0 0 / 15%) !important;
        }
      `
      document.head.append(style)
    })
    try {
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
      const bounds = await page.locator('[data-settings-panel]').boundingBox()
      if (!bounds) throw new Error('Settings glass bounds are unavailable')
      const inset = 64
      return await page.screenshot({
        clip: {
          x: bounds.x + inset,
          y: bounds.y + inset,
          width: bounds.width - inset * 2,
          height: bounds.height - inset * 2,
        },
      })
    } finally {
      await page.evaluate(() => document.querySelector('[data-glass-pixel-fixture]')?.remove())
    }
  }

  const clearGlass = await captureSettingsBackdrop()
  await blurSlider.press('End')
  await expect.poll(() => blurSlider.getAttribute('aria-valuenow')).toBe('40')
  const blurredGlass = await captureSettingsBackdrop()
  const clearEnergy = await pixelEdgeEnergy(clearGlass)
  const blurredEnergy = await pixelEdgeEnergy(blurredGlass)
  expect(clearEnergy).toBeGreaterThan(blurredEnergy * 1.8)
  await testInfo.attach('settings-glass-blur-0', { body: clearGlass, contentType: 'image/png' })
  await testInfo.attach('settings-glass-blur-40', { body: blurredGlass, contentType: 'image/png' })

  const liveGlassAtMaximumBlur = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-flux-glass-surface]')).map((surface) => {
      const config = JSON.parse(surface.dataset.glassConfig || '{}') as { blur?: number }
      const distortion = surface.querySelector<HTMLElement>('.glass-ui-distortion-layer')
      const card = surface.querySelector<HTMLElement>('.glass-ui-container')
      const edgeSheet = surface.closest<HTMLElement>('[data-edge-sheet]')
      return {
        blur: config.blur,
        backdropFilter: edgeSheet
          ? getComputedStyle(edgeSheet).backdropFilter
          : distortion
            ? getComputedStyle(distortion).backdropFilter
            : '',
        cardFilter: card ? getComputedStyle(card).filter : '',
      }
    }),
  )
  expect(liveGlassAtMaximumBlur.length).toBeGreaterThanOrEqual(4)
  for (const surface of liveGlassAtMaximumBlur) {
    expect(surface.blur).toBe(40)
    expect(surface.backdropFilter).toContain('blur(40px)')
    expect(surface.cardFilter).toBe('none')
  }

  const inspectGlobalTargets = () =>
    page.evaluate(() => {
      const selectors = {
        left: '[data-edge-sheet][data-side="left"] [data-edge-sheet-glass]',
        right: '[data-edge-sheet][data-side="right"] [data-edge-sheet-glass]',
        settings: '[data-settings-panel]',
        search: '[data-search-glass]',
      } as const
      return Object.entries(selectors).map(([name, selector]) => {
        const surface = document.querySelector<HTMLElement>(selector)!
        const config = JSON.parse(surface.dataset.glassConfig || '{}') as {
          blur?: number
          borderOpacity?: number
        }
        const border = surface.querySelector<HTMLElement>('.glass-ui-border-layer')!
        const distortion = surface.querySelector<HTMLElement>('.glass-ui-distortion-layer')!
        const edgeSheet = surface.closest<HTMLElement>('[data-edge-sheet]')
        return {
          name,
          scope: surface.dataset.glassScope,
          blur: config.blur,
          borderOpacity: config.borderOpacity,
          computedBorderOpacity: getComputedStyle(border).opacity,
          backdropFilter: getComputedStyle(edgeSheet ?? distortion).backdropFilter,
        }
      })
    })

  const namedGlobalTargets = await inspectGlobalTargets()
  expect(namedGlobalTargets.map((target) => target.name)).toEqual(['left', 'right', 'settings', 'search'])
  for (const target of namedGlobalTargets) {
    expect(target.scope).toBe('global')
    expect(target.blur).toBe(40)
    expect(target.backdropFilter).toContain('blur(40px)')
  }

  const borderOpacitySlider = page.getByRole('slider', { name: '边框透明度', exact: true })
  await borderOpacitySlider.focus()
  await borderOpacitySlider.press('End')
  await expect.poll(() => borderOpacitySlider.getAttribute('aria-valuenow')).toBe('1')
  for (const target of await inspectGlobalTargets()) {
    expect(target.borderOpacity).toBe(1)
    expect(target.computedBorderOpacity).toBe('1')
  }

  const backgroundTab = page.getByRole('tab', { name: '背景', exact: true })
  await backgroundTab.click()
  await page.getByRole('combobox', { name: '动态背景', exact: true }).click()
  const selectGlass = page.locator('[data-glass-select-surface]')
  await expect(selectGlass).toBeVisible()
  const selectGlassState = await selectGlass.evaluate((surface) => {
    const config = JSON.parse(surface.dataset.glassConfig || '{}') as { blur?: number }
    const card = surface.querySelector<HTMLElement>('.glass-ui-container')
    const distortion = surface.querySelector<HTMLElement>('.glass-ui-distortion-layer')
    return {
      blur: config.blur,
      backdropFilter: distortion ? getComputedStyle(distortion).backdropFilter : '',
      cardFilter: card ? getComputedStyle(card).filter : '',
      cardShadow: card ? getComputedStyle(card).boxShadow : '',
    }
  })
  expect(selectGlassState.blur).toBe(40)
  expect(selectGlassState.backdropFilter).toContain('blur(40px)')
  expect(selectGlassState.cardFilter).toBe('none')
  expect(selectGlassState.cardShadow).not.toBe('none')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '打开 Wallpaper Engine 项目库', exact: true }).click()
  const wallpaperGlass = page.locator('[data-wallpaper-library-glass]')
  await expect(wallpaperGlass).toBeVisible()
  const wallpaperGlassState = await wallpaperGlass.evaluate((surface) => {
    const config = JSON.parse(surface.dataset.glassConfig || '{}') as { blur?: number }
    const card = surface.querySelector<HTMLElement>('.glass-ui-container')
    const distortion = surface.querySelector<HTMLElement>('.glass-ui-distortion-layer')
    return {
      blur: config.blur,
      backdropFilter: distortion ? getComputedStyle(distortion).backdropFilter : '',
      cardFilter: card ? getComputedStyle(card).filter : '',
      cardShadow: card ? getComputedStyle(card).boxShadow : '',
    }
  })
  expect(wallpaperGlassState.blur).toBe(40)
  expect(wallpaperGlassState.backdropFilter).toContain('blur(40px)')
  expect(wallpaperGlassState.cardFilter).toBe('none')
  expect(wallpaperGlassState.cardShadow).not.toBe('none')
  await page.getByRole('button', { name: '关闭项目库', exact: true }).click()
  await expect(wallpaperGlass).toHaveCount(0)

  await glassTab.click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem('fluxplayer-glass-v1')
        return raw ? (JSON.parse(raw) as { config?: { blur?: number } }).config?.blur : null
      }),
    )
    .toBe(40)
  await page.getByRole('button', { name: '恢复默认', exact: true }).click()
  await expect.poll(() => blurSlider.getAttribute('aria-valuenow')).toBe('10')
  await expect.poll(() => borderOpacitySlider.getAttribute('aria-valuenow')).toBe('0')
  for (const tabName of ['玻璃', '背景', '歌词', '系统'] as const) {
    const tab = page.getByRole('tab', { name: tabName, exact: true })
    await tab.click()
    await expect(tab).toHaveAttribute('data-state', 'active')
    await expect
      .poll(() =>
        dialog.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return { width: rect.width, height: rect.height }
        }),
      )
      .toEqual(stableSettingsSize)
    if (tabName !== '系统') {
      const attachmentName =
        tabName === '玻璃' ? 'settings-glass' : tabName === '背景' ? 'settings-background' : 'settings-lyrics'
      await testInfo.attach(attachmentName, {
        body: await dialog.screenshot(),
        contentType: 'image/png',
      })
    }
  }
  await expect(page.locator('[data-system-maintenance]')).toBeVisible()
  await testInfo.attach('settings-system', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  })
  await page.keyboard.press('Escape')
  await settingsButton.evaluate((button: HTMLButtonElement) => button.click())
  await expect(dialog).toHaveAttribute('data-state', 'open')
  await expect
    .poll(() =>
      dialog.evaluate((element) => ({
        opacity: getComputedStyle(element).opacity,
      })),
    )
    .toEqual({ opacity: '1' })
  const dialogCenter = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      viewportX: window.innerWidth / 2,
      viewportY: window.innerHeight / 2,
    }
  })
  expect(dialogCenter.x).toBeCloseTo(dialogCenter.viewportX, 0)
  expect(dialogCenter.y).toBeCloseTo(dialogCenter.viewportY, 0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  expect(rendererCrashes).toEqual([])
})

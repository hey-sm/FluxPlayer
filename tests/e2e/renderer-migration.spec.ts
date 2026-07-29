import type { CDPSession } from '@playwright/test'
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

test('Renderer 样式迁移最终交互、长列表与布局性能验收', async ({ electronHarness }) => {
  test.setTimeout(60_000)
  const { app, page, rendererCrashes } = electronHarness

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

  const edgeStyles = await page.evaluate(() => {
    const read = (side: 'left' | 'right') => {
      const element = document.querySelector<HTMLElement>(`[data-edge-sheet][data-side="${side}"]`)!
      const style = getComputedStyle(element)
      return {
        background: style.backgroundColor,
        backdropFilter: style.backdropFilter,
        boxShadow: style.boxShadow,
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
      ringLayer: probeStyle.boxShadow.split(', ')[0],
    }
    probe.remove()
    return { left: read('left'), right: read('right'), expected }
  })
  expect(edgeStyles.left.borderRadius).toEqual(['0px', '15px', '15px', '0px'])
  expect(edgeStyles.right.borderRadius).toEqual(['15px', '0px', '0px', '15px'])
  for (const style of [edgeStyles.left, edgeStyles.right]) {
    expect(style.background).toBe(edgeStyles.expected.background)
    expect(style.backdropFilter).toBe(edgeStyles.expected.backdropFilter)
    // Only the bottom edge is stroked, so the classic treatment's all-around inset ring is dropped.
    expect(style.boxShadow).not.toContain(edgeStyles.expected.ringLayer)
    expect(style.boxShadow).toMatch(/0px -1px 0px 0px inset/)
  }

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
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThanOrEqual(540)
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
    .toEqual({ opacity: '1', transform: 'matrix(1, 0, 0, 1, 0, 0)' })
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
    .toEqual({ opacity: '1', transform: 'matrix(1, 0, 0, 1, 0, 0)' })

  const settingsButton = page.getByRole('button', { name: '设置' })
  await settingsButton.click()
  const dialog = page.locator('[data-dialog-motion-content]')
  await expect(dialog).toHaveAttribute('data-state', 'open')
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

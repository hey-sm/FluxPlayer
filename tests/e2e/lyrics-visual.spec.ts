import { expect, test } from './electron.fixture'
import sharp from 'sharp'

const TRACK = {
  provider: 'netease',
  type: 'song',
  id: 62_000_001,
  name: '三维歌词视觉检查',
  artist: 'FluxPlayer',
  artists: [{ id: 62_000_002, name: 'FluxPlayer' }],
  album: 'Visual Fixture',
  cover: '',
  duration: 30_000,
  fee: 0,
  playable: true,
} as const

const LYRICS = [
  '听见光穿过城市的边缘',
  '让每一次呼吸都有回声',
  '我们沿着夜色继续前行',
  '直到星河落进你的眼睛',
  '此刻世界只剩下旋律',
].map((text, lineIndex) => {
  const time = lineIndex * 3
  const characters = Array.from(text)
  const duration = 3 / characters.length
  return {
    time,
    text,
    words: characters.map((character, characterIndex) => ({
      text: character,
      time: time + characterIndex * duration,
      duration,
    })),
  }
})

async function canvasSignal(image: Buffer): Promise<{ range: number; deviation: number }> {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .resize(64, 64)
    .raw()
    .toBuffer({ resolveWithObject: true })
  let minimum = 255
  let maximum = 0
  let sum = 0
  let squaredSum = 0
  const pixels = info.width * info.height
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const luminance = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722
    minimum = Math.min(minimum, luminance)
    maximum = Math.max(maximum, luminance)
    sum += luminance
    squaredSum += luminance * luminance
  }
  const average = sum / pixels
  return { range: maximum - minimum, deviation: Math.sqrt(squaredSum / pixels - average * average) }
}

async function canvasDelta(before: Buffer, after: Buffer): Promise<number> {
  const [beforePixels, afterPixels] = await Promise.all(
    [before, after].map((image) => sharp(image).removeAlpha().resize(64, 64).raw().toBuffer()),
  )
  let difference = 0
  for (let index = 0; index < beforePixels.length; index += 1) {
    difference += Math.abs(beforePixels[index] - afterPixels[index])
  }
  return difference / beforePixels.length
}

test('3D 歌词在桌面与紧凑窗口保持可见', async ({ electronHarness }, testInfo) => {
  const { app, page } = electronHarness
  await electronHarness.installMusicFixture({ query: 'LYRICS VISUAL', track: TRACK, lyrics: LYRICS })

  const window = await app.browserWindow(page)
  await window.evaluate((browserWindow) => browserWindow.setSize(1440, 900))

  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByRole('combobox', { name: '歌词动效' })).toHaveCount(0)
  const lyricsDragSwitch = page.getByRole('switch', { name: '允许拖拽歌词' })
  await expect(lyricsDragSwitch).toHaveAttribute('aria-checked', 'false')
  await lyricsDragSwitch.click()
  await expect(lyricsDragSwitch).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: '关闭', exact: true }).click()

  await page.locator('.search-hover-sensor').hover()
  await page.getByPlaceholder(/搜索歌曲/).fill('LYRICS VISUAL')
  await page.getByText(TRACK.name, { exact: true }).click()
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible()
  await page.evaluate(() => {
    const audio = (
      globalThis as typeof globalThis & { __fluxE2EAudioElements?: HTMLAudioElement[] }
    ).__fluxE2EAudioElements?.at(-1)
    if (audio) audio.currentTime = 3.4
  })
  await page.waitForTimeout(900)
  await testInfo.attach('lyrics-desktop', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })

  const canvas = page.locator('.stage-bg canvas')
  await expect(canvas).toBeVisible()
  const desktopShot = await canvas.screenshot()
  const desktopSignal = await canvasSignal(desktopShot)
  expect(desktopSignal.range).toBeGreaterThan(40)
  expect(desktopSignal.deviation).toBeGreaterThan(8)

  await window.evaluate((browserWindow) => browserWindow.setSize(900, 650))
  await page.waitForTimeout(500)
  await testInfo.attach('lyrics-compact', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  const compactShot = await canvas.screenshot()
  const compactSignal = await canvasSignal(compactShot)
  expect(compactSignal.range).toBeGreaterThan(40)
  expect(compactSignal.deviation).toBeGreaterThan(8)

  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  if (bounds) {
    await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.58, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(450)
    expect(await canvasDelta(compactShot, await canvas.screenshot())).toBeGreaterThan(2)
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('flux-lyrics-offset')))
      .not.toBe('{"x":0,"y":0}')

    const movedOffset = await page.evaluate(() => localStorage.getItem('flux-lyrics-offset'))
    await page.getByRole('button', { name: '设置' }).click()
    await page.getByRole('switch', { name: '允许拖拽歌词' }).click()
    await page.getByRole('button', { name: '关闭', exact: true }).click()

    await page.evaluate(() => {
      const audio = (
        globalThis as typeof globalThis & { __fluxE2EAudioElements?: HTMLAudioElement[] }
      ).__fluxE2EAudioElements?.at(-1)
      if (audio) {
        audio.pause()
        audio.currentTime = 4.2
      }
    })
    await page.waitForTimeout(300)
    const beforeRotation = await canvas.screenshot()
    await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * 0.38, bounds.y + bounds.height * 0.42, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(350)
    const rotatedShot = await canvas.screenshot()
    expect(await canvasDelta(beforeRotation, rotatedShot)).toBeGreaterThan(0.5)
    await testInfo.attach('lyrics-orbit', { body: await page.screenshot(), contentType: 'image/png' })
    expect(await page.evaluate(() => localStorage.getItem('flux-lyrics-offset'))).toBe(movedOffset)
  }
})

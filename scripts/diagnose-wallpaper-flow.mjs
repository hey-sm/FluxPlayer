import { _electron as electron } from '@playwright/test'
import path from 'node:path'

const targetTitle = process.argv.slice(2).join(' ') || 'Eye of the Storm'
const env = { ...process.env, FLUX_E2E: '1' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL

const app = await electron.launch({
  args: [path.resolve('out/main/index.mjs')],
  cwd: process.cwd(),
  env,
  timeout: 30_000,
})

const page = await app.firstWindow({ timeout: 30_000 })
if (process.env.FLUX_WALLPAPER_VIEWPORT) {
  const [width, height] = process.env.FLUX_WALLPAPER_VIEWPORT.split('x').map(Number)
  if (Number.isFinite(width) && Number.isFinite(height)) await page.setViewportSize({ width, height })
}
await page.locator('#root').waitFor({ state: 'attached' })
const original = await page.evaluate(() => window.fluxDesktop?.getWallpaperEngineState())

try {
  // Stop any persisted selection before the click under test. Startup resume
  // is asynchronous and can otherwise overwrite the newly selected project.
  await page.evaluate(() => window.fluxDesktop?.setWallpaperEngineState({ action: 'clear' }))
  await page.waitForFunction(
    async () => (await window.fluxDesktop?.getWallpaperEngineState())?.selection.active === false,
    undefined,
    { timeout: 10_000 },
  )
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('tab', { name: '背景' }).click()
  await page.getByRole('button', { name: '打开 Wallpaper Engine 项目库' }).click()
  await page.getByText(targetTitle, { exact: true }).waitFor({ timeout: 20_000 })
  if (process.env.FLUX_WALLPAPER_SCREENSHOT) {
    await page.screenshot({ path: process.env.FLUX_WALLPAPER_SCREENSHOT })
  }
  const scanned = await page.evaluate(() => window.fluxDesktop?.listWallpaperEngineProjects(false))
  const selectedProject = scanned?.projects.find((item) => item.title === targetTitle)
  const selectedState = await page.evaluate(
    (id) => window.fluxDesktop?.setWallpaperEngineState({ action: 'select', id }),
    selectedProject?.id,
  )
  const result = await page.evaluate(async (selectedProject) => {
    const timeline = []
    for (let index = 0; index < 2; index += 1) {
      const layer = document.querySelector('[data-wallpaper-engine-layer]')
      const video = layer?.querySelector('video')
      timeline.push({
        elapsed: index * 150,
        status: await window.fluxDesktop?.getWallpaperEngineRuntimeStatus(),
        state: await window.fluxDesktop?.getWallpaperEngineState(),
        layer: layer?.getAttribute('data-wallpaper-engine-kind') ?? '',
        hasVideo: Boolean(video),
        readyState: video?.readyState ?? -1,
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    const layer = document.querySelector('[data-wallpaper-engine-layer]')
    const video = layer?.querySelector('video')
    const status = await window.fluxDesktop?.getWallpaperEngineRuntimeStatus()
    const state = await window.fluxDesktop?.getWallpaperEngineState()
    if (selectedProject?.projectType === 'scene') {
      return {
        project: selectedProject,
        status,
        state,
        timeline,
        nativeActive: status?.active === true && status.mode === 'dwm' && status.phase === 'active',
        hasDomMainLayer: Boolean(layer),
        hasMainVideo: Boolean(video),
      }
    }
    if (!layer || !video)
      return { project: selectedProject, status, state, timeline, error: 'layer/video missing' }
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 90
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const sample = () => {
      if (!context) return 0
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data
      let hash = 2166136261
      for (let index = 0; index < data.length; index += 97) {
        hash ^= data[index]
        hash = Math.imul(hash, 16777619)
      }
      return hash >>> 0
    }
    const first = sample()
    await new Promise((resolve) => setTimeout(resolve, 1800))
    const second = sample()
    return {
      project: selectedProject,
      status,
      state,
      timeline,
      kind: layer.dataset.wallpaperEngineKind,
      opacity: getComputedStyle(layer).opacity,
      readyState: video.readyState,
      paused: video.paused,
      width: video.videoWidth,
      height: video.videoHeight,
      first,
      second,
      animated: first !== second,
    }
  }, selectedProject)
  result.selectedState = selectedState
  console.log(JSON.stringify(result, null, 2))
} finally {
  if (process.env.FLUX_WALLPAPER_KEEP_SELECTION !== '1') {
    if (original?.selection.active && original.selection.id) {
      await page.evaluate(
        (id) => window.fluxDesktop?.setWallpaperEngineState({ action: 'select', id }),
        original.selection.id,
      )
    } else {
      await page.evaluate(() => window.fluxDesktop?.setWallpaperEngineState({ action: 'clear' }))
    }
  }
  await app.close()
}

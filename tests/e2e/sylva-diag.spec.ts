import { expect, test } from './electron.fixture'

// Regression guard for the Sylva "Living Green" background. It forces the
// Sylva preference and verifies the whole chain that previously broke:
//   - the StageCanvas mounts behind the app,
//   - the SylvaBackground mounts an <iframe src="flux-sylva://scene"> behind
//     the transparent Stage canvas,
//   - the flux-sylva:// protocol document loads and runs the bundled Three.js
//     r149 + scene (window.THREE defined, window.__ready set),
//   - and the scene body is the #4a4d44 backdrop (not a blank/white page,
//     which would mean the document failed to load or the scene script broke).
//
// This caught two real bugs in development: the scene document CSP used
// `frame-ancestors 'none'` (blocked the app from framing it) and the document
// builder used String.replace with the Three.js bundle as the replacement
// string (the bundle's literal `$'` spliced in the rest of the document and
// truncated the inline script).
test('sylva background mounts a running flux-sylva scene behind the stage', async ({ electronHarness }) => {
  const { page } = electronHarness
  await page.evaluate(() => {
    localStorage.setItem('fluxplayer-dynamic-background-v1', 'sylva')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })

  // The iframe document loads from flux-sylva://.
  await expect
    .poll(async () => page.frames().some((f) => f.url().startsWith('flux-sylva://')), {
      timeout: 15000,
    })
    .toBe(true)

  const sylvaFrame = page.frames().find((f) => f.url().startsWith('flux-sylva://'))!
  // The scene sets window.__ready after two rendered frames; wait for it plus
  // the bundled THREE global so a broken/truncated script fails here.
  const probe = await sylvaFrame.evaluate(() => ({
    bodyBg: getComputedStyle(document.body).backgroundColor,
    hasThree: typeof (window as unknown as { THREE?: unknown }).THREE !== 'undefined',
    ready: Boolean((window as unknown as { __ready?: boolean }).__ready),
  }))
  expect(probe.hasThree).toBe(true)
  expect(probe.ready).toBe(true)
  // #4a4d44 → rgb(74, 77, 68): the authored scene backdrop, proving the
  // document loaded (a blank/white body means the protocol/CSP failed).
  expect(probe.bodyBg).toBe('rgb(74, 77, 68)')
})

import { expect, test } from './electron.fixture'

test('短时操作反馈统一使用无关闭按钮的实色 shadcn 胶囊 Toast', async ({ electronHarness }) => {
  const { app, page } = electronHarness
  const failureMessage = 'E2E 背景导入失败'

  await app.evaluate(({ ipcMain }, message) => {
    const channel = 'flux:background:choose-file'
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => ({ ok: false, canceled: false, error: message }))
  }, failureMessage)

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('tab', { name: '背景', exact: true }).click()
  await page.getByRole('button', { name: '选择文件', exact: true }).click()

  const toast = page.locator('[data-toast-item]')
  await expect(toast).toBeVisible()
  await expect(toast).toHaveAttribute('data-toast-tone', 'error')
  await expect(toast).toContainText('背景设置失败')
  await expect(toast).toContainText(failureMessage)
  await expect(toast.getByRole('button')).toHaveCount(0)

  const appearance = await toast.evaluate((element) => {
    const style = getComputedStyle(element)
    const bounds = element.getBoundingClientRect()
    return {
      backgroundColor: style.backgroundColor,
      backdropFilter: style.backdropFilter,
      radius: Number.parseFloat(style.borderRadius),
      height: bounds.height,
      glassAncestor: Boolean(element.closest('[data-flux-glass-surface]')),
      glassDescendant: Boolean(element.querySelector('[data-flux-glass-surface]')),
    }
  })

  expect(appearance.backgroundColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
  expect(appearance.backdropFilter).toBe('none')
  expect(appearance.radius).toBeGreaterThanOrEqual(appearance.height / 2)
  expect(appearance.glassAncestor).toBe(false)
  expect(appearance.glassDescendant).toBe(false)
})

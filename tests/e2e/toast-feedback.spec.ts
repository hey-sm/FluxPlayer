import { expect, test } from './electron.fixture'

test('短时操作反馈在顶栏显示胶囊 Toast', async ({ electronHarness }) => {
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

  // 顶栏 CenterStatus 渲染 toast：等待错误标题文字出现
  await expect(page.getByText('背景设置失败')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText(failureMessage)).toBeVisible()
})

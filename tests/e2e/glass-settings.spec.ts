import { expect, test } from './electron.fixture'

test('玻璃默认值与外部光照控件映射到全部全局 Surface', async ({ electronHarness }) => {
  const { page } = electronHarness

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('tab', { name: '玻璃', exact: true }).click()

  const defaultSliders = [
    ['模糊', '10'],
    ['折射强度', '50'],
    ['饱和度', '100'],
    ['亮度', '100'],
    ['色差', '0'],
    ['全局圆角', '20'],
    ['边框宽度', '1'],
    ['边框透明度', '0'],
    ['背景透明度', '0'],
    ['内部光扩散', '0'],
    ['内部光模糊', '60'],
    ['内部光透明度', '0.3'],
    ['外部光扩散', '0'],
    ['外部光模糊', '0'],
    ['外部光透明度', '0'],
  ] as const

  for (const [name, value] of defaultSliders) {
    await expect(page.getByRole('slider', { name, exact: true })).toHaveAttribute('aria-valuenow', value)
  }
  await expect(page.getByLabel('内容颜色十六进制色值')).toHaveValue('#FFFFFF')
  await expect(page.getByLabel('边框颜色十六进制色值')).toHaveValue('#FFFFFF')
  await expect(page.getByLabel('背景颜色十六进制色值')).toHaveValue('#000000FF')
  await expect(page.getByLabel('内部光颜色十六进制色值')).toHaveValue('#FFFFFF')
  await expect(page.getByLabel('外部光颜色十六进制色值')).toHaveValue('#FFFFFF')

  const settingsSurface = page.locator('[data-settings-panel]')
  await expect(settingsSurface.locator('.glass-ui-outer-light')).toHaveCount(0)

  await page.getByRole('slider', { name: '外部光扩散', exact: true }).press('End')
  await page.getByRole('slider', { name: '外部光模糊', exact: true }).press('End')
  await page.getByRole('slider', { name: '外部光透明度', exact: true }).press('End')
  const outerColor = page.getByLabel('外部光颜色十六进制色值')
  await outerColor.fill('#FF3366')
  await outerColor.press('Enter')

  const readOuterLight = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((surface) => {
        const config = JSON.parse((surface as HTMLElement).dataset.glassConfig || '{}') as {
          outerLightSpread?: number
          outerLightBlur?: number
          outerLightOpacity?: number
          outerLightColor?: string
        }
        const layer = surface.querySelector<HTMLElement>('.glass-ui-outer-light')
        const style = getComputedStyle(surface)
        return {
          config,
          variables: {
            spread: style.getPropertyValue('--flux-glass-outer-light-spread').trim(),
            blur: style.getPropertyValue('--flux-glass-outer-light-blur').trim(),
            opacity: style.getPropertyValue('--flux-glass-outer-light-opacity').trim(),
            color: style.getPropertyValue('--flux-glass-outer-light-color').trim(),
          },
          layer: layer
            ? {
                opacity: getComputedStyle(layer).opacity,
                boxShadow: getComputedStyle(layer).boxShadow,
              }
            : null,
        }
      })

  const settingsOuterLight = await readOuterLight('[data-settings-panel]')
  expect(settingsOuterLight).toMatchObject({
    config: {
      outerLightSpread: 20,
      outerLightBlur: 80,
      outerLightOpacity: 1,
      outerLightColor: '#ff3366',
    },
    variables: { spread: '20px', blur: '80px', opacity: '1', color: '#ff3366' },
    layer: { opacity: '1' },
  })
  expect(settingsOuterLight.layer?.boxShadow).toContain('80px')
  expect(settingsOuterLight.layer?.boxShadow).toContain('20px')
  expect(settingsOuterLight.layer?.boxShadow).toContain('rgb(255, 51, 102)')

  const edgeOuterLight = await readOuterLight('[data-edge-sheet-glass]')
  expect(edgeOuterLight.config).toMatchObject(settingsOuterLight.config)
  expect(edgeOuterLight.variables).toEqual(settingsOuterLight.variables)
  expect(edgeOuterLight.layer).toEqual(settingsOuterLight.layer)

  await page.getByRole('button', { name: '恢复默认', exact: true }).click()
  await expect(page.getByRole('slider', { name: '外部光扩散', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '0',
  )
  await expect(page.getByRole('slider', { name: '外部光模糊', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '0',
  )
  await expect(page.getByRole('slider', { name: '外部光透明度', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '0',
  )
  await expect(page.getByRole('slider', { name: '内部光透明度', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '0.3',
  )
  await expect(settingsSurface.locator('.glass-ui-outer-light')).toHaveCount(0)
})

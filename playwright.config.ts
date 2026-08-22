import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig } from '@playwright/test'

const INVOCATION_ID_ENV = 'FLUXPLAYER_PLAYWRIGHT_INVOCATION_ID'
const invocationId = process.env[INVOCATION_ID_ENV] ?? `${Date.now()}-${process.pid}-${randomUUID()}`
// Config evaluation happens before workers are spawned, so every worker inherits this invocation value.
process.env[INVOCATION_ID_ENV] = invocationId

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  // CI runner 没有 GPU，Three.js 走软件渲染，画布截图与舞台重绘比本地慢 3～4 倍
  // （lyrics-visual 本地 15s，在 runner 上 45s 还没跑完）。本地保持 45s 以便快速失败。
  timeout: process.env.CI ? 120_000 : 45_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(tmpdir(), `fluxplayer-next-playwright-results-${invocationId}`),
  reporter: [['line']],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
})

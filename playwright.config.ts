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
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(tmpdir(), `fluxplayer-next-playwright-results-${invocationId}`),
  reporter: [['line']],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
})

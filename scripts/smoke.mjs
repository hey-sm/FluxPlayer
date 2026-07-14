#!/usr/bin/env node
/**
 * 烟雾测试：启动打包前的 Electron 应用（FLUX_SMOKE=1），
 * 主进程在窗口加载完成且 /api/app/version 正常响应后自动退出(0)。
 * 用法: node scripts/smoke.mjs [--legacy]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')

const sandboxPath = mkdtempSync(path.join(tmpdir(), 'fluxplayer-smoke-'))
const env = {
  ...process.env,
  FLUX_SMOKE: '1',
}
// VSCode/CI 等宿主环境可能带 ELECTRON_RUN_AS_NODE=1，会让 Electron 以纯 Node 启动，必须剔除
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(String(electronPath), [`--user-data-dir=${path.join(sandboxPath, 'user-data')}`, '.'], { env })
let sawOk = false
const forward = (stream, out) => {
  stream.on('data', (chunk) => {
    const text = chunk.toString()
    if (text.includes('[smoke] OK')) sawOk = true
    out.write(text)
  })
}
forward(child.stdout, process.stdout)
forward(child.stderr, process.stderr)
child.on('exit', (code) => {
  rmSync(sandboxPath, { recursive: true, force: true })
  const pass = sawOk && code === 0
  console.log(`[smoke] electron exited with code ${code}, marker=${sawOk ? 'seen' : 'MISSING'} => ${pass ? 'PASS' : 'FAIL'}`)
  process.exit(pass ? 0 : 1)
})

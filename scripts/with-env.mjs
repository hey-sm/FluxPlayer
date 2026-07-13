#!/usr/bin/env node
/** 跨平台 env 启动器：node scripts/with-env.mjs KEY=VAL... <command> [args...] */
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const env = { ...process.env }
let i = 0
while (i < args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[i])) {
  const idx = args[i].indexOf('=')
  env[args[i].slice(0, idx)] = args[i].slice(idx + 1)
  i++
}
const cmd = args[i]
if (!cmd) {
  console.error('usage: with-env.mjs KEY=VAL... <command> [args...]')
  process.exit(2)
}
const child = spawn(cmd, args.slice(i + 1), {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
})
child.on('exit', (code) => process.exit(code ?? 1))

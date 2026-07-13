#!/usr/bin/env node
/**
 * 一次性工具：为 @electron/get 填充本地缓存，绕开其 Node fetch 下载失败的问题。
 * 用法: node scripts/seed-electron-cache.mjs <zip路径> <shasums路径>
 * 之后运行: ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ node node_modules/electron/install.js
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const version = JSON.parse(fs.readFileSync('node_modules/electron/package.json', 'utf8')).version
const mirrorBase = 'https://registry.npmmirror.com/-/binary/electron/'
const fileName = `electron-v${version}-win32-x64.zip`
const dirUrl = new URL(mirrorBase + `v${version}/` + fileName)
dirUrl.hash = ''
dirUrl.search = ''
dirUrl.pathname = path.posix.dirname(dirUrl.pathname)
const hash = crypto.createHash('sha256').update(dirUrl.toString()).digest('hex')

const cacheRoot = path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache')
const cacheDir = path.join(cacheRoot, hash)
fs.mkdirSync(cacheDir, { recursive: true })

const [zipSrc, shaSrc] = process.argv.slice(2)
if (!zipSrc || !fs.existsSync(zipSrc)) {
  console.error('zip not found:', zipSrc)
  process.exit(1)
}
fs.copyFileSync(zipSrc, path.join(cacheDir, fileName))
if (shaSrc && fs.existsSync(shaSrc)) {
  fs.copyFileSync(shaSrc, path.join(cacheDir, 'SHASUMS256.txt'))
}
console.log('cache dir url =', dirUrl.toString())
console.log('seeded:', cacheDir)
console.log('files:', fs.readdirSync(cacheDir).join(', '))

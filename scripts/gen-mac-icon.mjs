#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import sharp from 'sharp'

if (process.platform !== 'darwin') throw new Error('macOS icon generation requires iconutil')

const root = path.resolve(import.meta.dirname, '..')
const source = path.join(root, 'resources', 'icon.svg')
const iconset = path.join(root, 'resources', 'icon.iconset')
const output = path.join(root, 'resources', 'icon.icns')
const variants = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
]

fs.rmSync(iconset, { recursive: true, force: true })
fs.mkdirSync(iconset, { recursive: true })
try {
  await Promise.all(
    variants.map(([size, name]) =>
      sharp(source, { density: 384 })
        .resize(Number(size), Number(size))
        .png()
        .toFile(path.join(iconset, String(name))),
    ),
  )
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', output], { stdio: 'inherit' })
} finally {
  fs.rmSync(iconset, { recursive: true, force: true })
}

console.log('[icons] generated', path.relative(root, output))

#!/usr/bin/env node
/** 从 resources/icon.svg 生成 resources/icon.png（512×512，electron-builder 会自动转 ico） */
import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'resources', 'icon.svg')
const out = path.join(root, 'resources', 'icon.png')

await sharp(src, { density: 288 }).resize(512, 512).png().toFile(out)
console.log('[gen-icons] 生成', out)

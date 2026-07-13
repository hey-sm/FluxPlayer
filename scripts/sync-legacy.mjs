#!/usr/bin/env node
/**
 * 同步 legacy 前端副本：把旧项目的 public/ 复制到 fluxplayer-next/legacy/。
 * 只读旧目录，绝不写入旧目录。legacy/ 在 .gitignore 中，属于生成物。
 */
import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.resolve(projectRoot, '..', 'public')
const target = path.resolve(projectRoot, 'legacy')

if (!existsSync(path.join(source, 'index.html'))) {
  console.error(`[sync-legacy] 找不到旧前端: ${source}`)
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
console.log(`[sync-legacy] ${source} -> ${target} 完成`)

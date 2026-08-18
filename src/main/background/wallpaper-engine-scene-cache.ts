import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const PACKAGE_INDEX_MAX_BYTES = 16 * 1024 * 1024
const PACKAGE_SCENE_MAX_BYTES = 32 * 1024 * 1024
const PACKAGE_ENTRY_MAX_COUNT = 32_768
const PACKAGE_ENTRY_NAME_MAX_BYTES = 4096
const CACHE_VERSION = 1

interface PackageScene {
  dataOffset: number
  sceneLength: number
  scene: Record<string, unknown>
  packageSize: number
  packageMtimeMs: number
}

export interface SilentSceneProject {
  projectFile: string
  scenePackage: string
  audioObjectCount: number
}

function runtimeError(code: string): Error {
  return new Error(code)
}

async function statFile(target: string): Promise<fs.Stats | null> {
  try {
    const stat = await fsp.stat(target)
    return stat.isFile() ? stat : null
  } catch {
    return null
  }
}

async function readFileHandleRange(
  handle: fsp.FileHandle,
  length: number,
  position: number,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, position + offset)
    if (result.bytesRead <= 0) throw runtimeError('WALLPAPER_SCENE_PACKAGE_INVALID')
    offset += result.bytesRead
  }
  return buffer
}

function readUInt32(buffer: Buffer, state: { offset: number }): number {
  if (state.offset < 0 || state.offset + 4 > buffer.length) {
    throw runtimeError('WALLPAPER_SCENE_PACKAGE_INDEX_INVALID')
  }
  const value = buffer.readUInt32LE(state.offset)
  state.offset += 4
  return value
}

function readString(buffer: Buffer, state: { offset: number }, maximumLength: number): string {
  const length = readUInt32(buffer, state)
  if (length <= 0 || length > maximumLength || state.offset + length > buffer.length) {
    throw runtimeError('WALLPAPER_SCENE_PACKAGE_INDEX_INVALID')
  }
  const value = buffer.subarray(state.offset, state.offset + length).toString('utf8')
  state.offset += length
  return value
}

export async function readWallpaperPackageScene(scenePackage: string): Promise<PackageScene> {
  const packageStat = await statFile(scenePackage)
  if (!packageStat || packageStat.size < 32) throw runtimeError('WALLPAPER_SCENE_PACKAGE_INVALID')
  const handle = await fsp.open(scenePackage, 'r')
  try {
    const indexLength = Math.min(packageStat.size, PACKAGE_INDEX_MAX_BYTES)
    const indexBuffer = await readFileHandleRange(handle, indexLength, 0)
    const state = { offset: 0 }
    const header = readString(indexBuffer, state, 32)
    if (!/^PKGV\d{4}$/i.test(header)) {
      throw runtimeError('WALLPAPER_SCENE_PACKAGE_FORMAT_UNSUPPORTED')
    }
    const entryCount = readUInt32(indexBuffer, state)
    if (entryCount <= 0 || entryCount > PACKAGE_ENTRY_MAX_COUNT) {
      throw runtimeError('WALLPAPER_SCENE_PACKAGE_INDEX_INVALID')
    }
    let sceneEntry: { offset: number; length: number } | null = null
    for (let index = 0; index < entryCount; index += 1) {
      const name = readString(indexBuffer, state, PACKAGE_ENTRY_NAME_MAX_BYTES)
      const offset = readUInt32(indexBuffer, state)
      const length = readUInt32(indexBuffer, state)
      if (name.replace(/\\/g, '/').toLowerCase() === 'scene.json') sceneEntry = { offset, length }
    }
    if (!sceneEntry || sceneEntry.length <= 0 || sceneEntry.length > PACKAGE_SCENE_MAX_BYTES) {
      throw runtimeError('WALLPAPER_SCENE_PACKAGE_SCENE_INVALID')
    }
    const dataOffset = state.offset + sceneEntry.offset
    if (
      !Number.isSafeInteger(dataOffset) ||
      dataOffset < state.offset ||
      dataOffset + sceneEntry.length > packageStat.size
    ) {
      throw runtimeError('WALLPAPER_SCENE_PACKAGE_SCENE_INVALID')
    }
    const sceneBuffer = await readFileHandleRange(handle, sceneEntry.length, dataOffset)
    const parsed = JSON.parse(sceneBuffer.toString('utf8').replace(/^\uFEFF/, '')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw runtimeError('WALLPAPER_SCENE_PACKAGE_SCENE_INVALID')
    }
    return {
      dataOffset,
      sceneLength: sceneEntry.length,
      scene: parsed as Record<string, unknown>,
      packageSize: packageStat.size,
      packageMtimeMs: Number(packageStat.mtimeMs) || 0,
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('WALLPAPER_SCENE_')) throw error
    throw runtimeError('WALLPAPER_SCENE_PACKAGE_SCENE_INVALID')
  } finally {
    await handle.close()
  }
}

function visitAudioObjects(
  scene: Record<string, unknown>,
  visitor: (value: Record<string, unknown>) => void,
): number {
  let audioObjectCount = 0
  let visited = 0
  const walk = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 128) return
    visited += 1
    if (visited > 250_000) throw runtimeError('WALLPAPER_SCENE_PACKAGE_SCENE_TOO_COMPLEX')
    const record = value as Record<string, unknown>
    if (Object.hasOwn(record, 'sound') && (typeof record.sound === 'string' || Array.isArray(record.sound))) {
      audioObjectCount += 1
      visitor(record)
    }
    for (const child of Object.values(record)) walk(child, depth + 1)
  }
  walk(scene, 0)
  return audioObjectCount
}

function forceSceneAudioSilent(scene: Record<string, unknown>): number {
  return visitAudioObjects(scene, (value) => {
    value.startsilent = true
    value.volume = 0
  })
}

function inspectSceneAudioSilence(scene: Record<string, unknown>): {
  audioObjectCount: number
  allSilent: boolean
} {
  let allSilent = true
  const audioObjectCount = visitAudioObjects(scene, (value) => {
    if (value.startsilent !== true || value.volume !== 0) allSilent = false
  })
  return { audioObjectCount, allSilent }
}

function encodePatchedScene(scene: Record<string, unknown>, originalLength: number): Buffer {
  const encoded = Buffer.from(JSON.stringify(scene), 'utf8')
  if (encoded.length > originalLength) throw runtimeError('WALLPAPER_SCENE_PACKAGE_PATCH_TOO_LARGE')
  const output = Buffer.alloc(originalLength, 0x20)
  encoded.copy(output)
  return output
}

async function validateMutedPackage(
  scenePackage: string,
  expectedPackageSize: number,
  expectedAudioObjectCount: number,
): Promise<boolean> {
  try {
    const cached = await readWallpaperPackageScene(scenePackage)
    if (cached.packageSize !== expectedPackageSize) return false
    const inspection = inspectSceneAudioSilence(cached.scene)
    return inspection.allSilent && inspection.audioObjectCount === expectedAudioObjectCount
  } catch {
    return false
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

export async function prepareSilentSceneProject(options: {
  cacheRoot: string
  projectFile: string
  scenePackage: string
}): Promise<SilentSceneProject> {
  const [realProjectFile, realScenePackage] = await Promise.all([
    fsp.realpath(options.projectFile),
    fsp.realpath(options.scenePackage),
  ])
  const source = await readWallpaperPackageScene(realScenePackage)
  const scene = structuredClone(source.scene)
  const audioObjectCount = forceSceneAudioSilent(scene)
  const patchedScene = encodePatchedScene(scene, source.sceneLength)
  const projectText = await fsp.readFile(realProjectFile, 'utf8')
  if (Buffer.byteLength(projectText) > 1024 * 1024)
    throw runtimeError('WALLPAPER_ENGINE_SCENE_MANIFEST_INVALID')
  const project = JSON.parse(projectText.replace(/^\uFEFF/, '')) as Record<string, unknown>
  if (
    !project ||
    typeof project !== 'object' ||
    Array.isArray(project) ||
    String(project.type ?? '')
      .trim()
      .toLowerCase() !== 'scene'
  ) {
    throw runtimeError('WALLPAPER_ENGINE_SCENE_MANIFEST_INVALID')
  }

  const digest = crypto
    .createHash('sha256')
    .update(`${CACHE_VERSION}\0${realScenePackage}\0${source.packageSize}\0${source.packageMtimeMs}`)
    .digest('hex')
    .slice(0, 32)
  const cacheRoot = path.resolve(options.cacheRoot)
  const targetRoot = path.join(cacheRoot, digest)
  const targetPackage = path.join(targetRoot, `scene${path.extname(realScenePackage).toLowerCase()}`)
  const targetProject = path.join(targetRoot, 'project.json')
  if (!isInside(cacheRoot, targetRoot)) throw runtimeError('WALLPAPER_ENGINE_SCENE_CACHE_INVALID')
  if (
    (await statFile(targetProject)) &&
    (await validateMutedPackage(targetPackage, source.packageSize, audioObjectCount))
  ) {
    return { projectFile: targetProject, scenePackage: targetPackage, audioObjectCount }
  }

  await fsp.mkdir(cacheRoot, { recursive: true })
  const temporaryRoot = path.join(cacheRoot, `.tmp-${digest}-${crypto.randomBytes(6).toString('hex')}`)
  if (!isInside(cacheRoot, temporaryRoot)) throw runtimeError('WALLPAPER_ENGINE_SCENE_CACHE_INVALID')
  try {
    await fsp.mkdir(temporaryRoot, { recursive: false })
    const temporaryPackage = path.join(temporaryRoot, path.basename(targetPackage))
    await fsp.copyFile(realScenePackage, temporaryPackage, fs.constants.COPYFILE_EXCL)
    const handle = await fsp.open(temporaryPackage, 'r+')
    try {
      await handle.write(patchedScene, 0, patchedScene.length, source.dataOffset)
      await handle.sync()
    } finally {
      await handle.close()
    }
    const stagedProject = { ...project, file: path.basename(targetPackage) }
    await fsp.writeFile(
      path.join(temporaryRoot, 'project.json'),
      JSON.stringify(stagedProject, null, 2),
      'utf8',
    )
    if (!(await validateMutedPackage(temporaryPackage, source.packageSize, audioObjectCount))) {
      throw runtimeError('WALLPAPER_SCENE_PACKAGE_PATCH_FAILED')
    }
    try {
      await fsp.rename(temporaryRoot, targetRoot)
    } catch {
      if (!(await statFile(targetProject))) throw runtimeError('WALLPAPER_ENGINE_SCENE_CACHE_WRITE_FAILED')
    }
  } finally {
    await fsp.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined)
  }
  if (!(await validateMutedPackage(targetPackage, source.packageSize, audioObjectCount))) {
    throw runtimeError('WALLPAPER_SCENE_PACKAGE_PATCH_FAILED')
  }
  return { projectFile: targetProject, scenePackage: targetPackage, audioObjectCount }
}

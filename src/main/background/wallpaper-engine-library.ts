import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Readable } from 'node:stream'
import {
  WALLPAPER_ENGINE_SCHEME,
  WALLPAPER_ENGINE_STATE_VERSION,
  type WallpaperEngineLibrarySnapshot,
  type WallpaperEngineManualRoot,
  type WallpaperEngineProject,
  type WallpaperEngineProjectDetails,
  type WallpaperEngineProjectProperty,
  type WallpaperEngineRuntimeProbe,
  type WallpaperEngineSelection,
} from '@shared/wallpaper-engine-contract'

const execFileAsync = promisify(execFile)
const WALLPAPER_ENGINE_APP_ID = '431960'
const CONFIG_FILE = 'wallpaper-engine-library.json'
const MAX_PROJECT_JSON_BYTES = 1024 * 1024
const MAX_MANUAL_SCAN_DIRS = 4000
const MAX_PROJECTS = 5000
const CACHE_TTL_MS = 30_000
const SCENE_EXTENSIONS = new Set(['.pkg', '.pak'])
const IMAGE_MIME = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])
const VIDEO_MIME = new Map([
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.m4v', 'video/mp4'],
  ['.mov', 'video/quicktime'],
])
const SAFE_MIME = new Map([...IMAGE_MIME, ...VIDEO_MIME])
const SAFE_PROPERTY_KEY = /^[a-z0-9_.-]{1,128}$/i
const BLOCKED_PROPERTY_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

interface LibraryConfig {
  version: 1
  manualRoots: string[]
  manualProjectFiles: string[]
}

interface ProjectRecord {
  id: string
  projectRoot: string
  projectFile: string
  runtimeProjectFile: string
  media: string
  mediaRoot: string
  preview: string
  previewRoot: string
  scenePackage: string
  sceneRoot: string
  workshopId: string
  dependencyWorkshopId: string
  presetProperties: Record<string, boolean | number | string>
  project: Record<string, unknown>
}

interface IndexedProject {
  item: WallpaperEngineProject
  record: ProjectRecord
}

type ProjectManifest = NonNullable<Awaited<ReturnType<typeof readManifest>>>

function normalizePath(value: unknown): string {
  const raw = String(value ?? '')
    .trim()
    .replace(/^"|"$/g, '')
  if (!raw) return ''
  try {
    return path.resolve(raw)
  } catch {
    return ''
  }
}

function pathKey(value: unknown): string {
  return normalizePath(value)
    .replace(/[\\/]+$/, '')
    .toLowerCase()
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  )
}

function opaqueId(value: string): string {
  return crypto.createHash('sha256').update(pathKey(value)).digest('hex').slice(0, 24)
}

function cleanText(value: unknown, fallback: string, limit = 160): string {
  const printable = Array.from(String(value ?? ''), (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 ? ' ' : character
  }).join('')
  const text = printable.replace(/\s+/g, ' ').trim().slice(0, limit)
  return text || fallback
}

function safeProjectType(value: unknown): WallpaperEngineProject['projectType'] {
  const type = String(value ?? '')
    .trim()
    .toLowerCase()
  return type === 'video' || type === 'image' || type === 'scene' || type === 'web' || type === 'application'
    ? type
    : 'unknown'
}

function safeWorkshopId(value: unknown): string {
  return String(value ?? '').match(/^\d{5,32}$/)?.[0] ?? ''
}

function safePresetProperties(value: unknown): Record<string, boolean | number | string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const properties: Record<string, boolean | number | string> = {}
  for (const [key, propertyValue] of Object.entries(value as Record<string, unknown>).slice(0, 256)) {
    if (!SAFE_PROPERTY_KEY.test(key) || BLOCKED_PROPERTY_KEYS.has(key.toLowerCase())) continue
    if (
      typeof propertyValue === 'boolean' ||
      typeof propertyValue === 'string' ||
      (typeof propertyValue === 'number' && Number.isFinite(propertyValue))
    ) {
      properties[key] = propertyValue
    }
  }
  return properties
}

function parseByteRange(
  value: string | null,
  size: number,
): { start: number; end: number } | { invalid: true } | null {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || (!match[1] && !match[2])) return { invalid: true }
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2] || 0))
  let end = match[2] ? Number(match[2]) : size - 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return { invalid: true }
  }
  start = Math.floor(start)
  end = Math.min(size - 1, Math.floor(end))
  return { start, end }
}

async function statSafe(target: string): Promise<fs.Stats | null> {
  try {
    return await fsp.stat(target)
  } catch {
    return null
  }
}

async function directoryExists(target: string): Promise<boolean> {
  const stat = await statSafe(target)
  return !!stat?.isDirectory()
}

async function readTextCommand(file: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync(file, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2500,
      maxBuffer: 256 * 1024,
    })
    return String(result.stdout ?? '')
  } catch {
    return ''
  }
}

export function parseSteamLibraryFoldersVdf(text: string): string[] {
  const result: string[] = []
  for (const match of text.matchAll(/"path"\s+"((?:\\.|[^"\\])*)"/gi)) {
    const value = match[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"').trim()
    if (value) result.push(path.resolve(value))
  }
  return [...new Set(result)]
}

async function steamRegistryRoots(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const roots: string[] = []
  for (const [key, value] of [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
  ] as const) {
    const output = await readTextCommand('reg.exe', ['query', key, '/v', value])
    const match = output.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)$`, 'im'))
    if (match?.[1]) {
      const root = normalizePath(match[1])
      if (root) roots.push(root)
    }
  }
  return roots
}

export async function discoverSteamLibraries(): Promise<string[]> {
  const candidates = [
    ...(await steamRegistryRoots()),
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Steam') : '',
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)']!, 'Steam') : '',
    process.env.STEAM_PATH ?? '',
  ]
    .map(normalizePath)
    .filter(Boolean)
  const result = new Set<string>()
  for (const root of new Set(candidates)) {
    if (!(await directoryExists(root))) continue
    result.add(root)
    try {
      const text = await fsp.readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')
      for (const library of parseSteamLibraryFoldersVdf(text)) {
        if (await directoryExists(library)) result.add(library)
      }
    } catch {
      // Steam may be installed without a readable VDF.
    }
  }
  return [...result]
}

async function resolveProjectFile(
  projectRoot: string,
  value: unknown,
  allowed: Map<string, string>,
): Promise<string> {
  const raw = String(value ?? '')
    .trim()
    .replace(/[\\/]/g, path.sep)
  if (!raw || raw.includes('\0') || path.isAbsolute(raw) || raw.includes(':')) return ''
  const lexicalRoot = path.resolve(projectRoot)
  const lexicalTarget = path.resolve(lexicalRoot, raw)
  if (!isInside(lexicalRoot, lexicalTarget)) return ''
  if (!allowed.has(path.extname(lexicalTarget).toLowerCase())) return ''
  try {
    const [realRoot, realTarget] = await Promise.all([fsp.realpath(lexicalRoot), fsp.realpath(lexicalTarget)])
    if (!isInside(realRoot, realTarget)) return ''
    const stat = await fsp.stat(realTarget)
    return stat.isFile() ? realTarget : ''
  } catch {
    return ''
  }
}

async function firstProjectFile(
  root: string,
  values: unknown[],
  allowed: Map<string, string>,
): Promise<string> {
  for (const value of values) {
    const result = await resolveProjectFile(root, value, allowed)
    if (result) return result
  }
  return ''
}

async function validScenePackage(file: string): Promise<string> {
  if (!file || !SCENE_EXTENSIONS.has(path.extname(file).toLowerCase())) return ''
  try {
    const handle = await fsp.open(file, 'r')
    try {
      const header = Buffer.alloc(12)
      const read = await handle.read(header, 0, header.length, 0)
      const first = header.subarray(0, 8).toString('ascii')
      const shifted = header.subarray(4, 12).toString('ascii')
      return read.bytesRead === header.length && (/^PKGV\d{4}$/.test(first) || /^PKGV\d{4}$/.test(shifted))
        ? file
        : ''
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

function analyzeProperties(project: Record<string, unknown>): {
  properties: WallpaperEngineProjectProperty[]
  audioCount: number
  mutedCount: number
} {
  const properties =
    project.general && typeof project.general === 'object' && !Array.isArray(project.general)
      ? (project.general as Record<string, unknown>).properties
      : null
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return { properties: [], audioCount: 0, mutedCount: 0 }
  }
  const output: WallpaperEngineProjectProperty[] = []
  let audioCount = 0
  let mutedCount = 0
  for (const [key, value] of Object.entries(properties as Record<string, unknown>).slice(0, 256)) {
    if (!SAFE_PROPERTY_KEY.test(key) || BLOCKED_PROPERTY_KEYS.has(key.toLowerCase())) continue
    const property =
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
    if (!property) continue
    const type =
      cleanText(property.type, 'unknown', 32)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '') || 'unknown'
    const label = cleanText(property.text, key)
    const hint = `${key} ${label}`.toLowerCase()
    const audio =
      /volume|mute|silent|audio|music|sound|bgm|音量|静音|音乐|声音/.test(hint) &&
      !/visual|color|opacity|spectrum|frequency|wave|频谱|颜色/.test(hint)
    const booleanValue = typeof property.value === 'boolean'
    const numericValue = typeof property.value === 'number' && Number.isFinite(property.value)
    const muteValue =
      audio && (booleanValue || numericValue || type === 'slider') ? (booleanValue ? true : 0) : null
    const descriptor: WallpaperEngineProjectProperty = {
      key,
      label,
      type,
      value:
        booleanValue || numericValue || typeof property.value === 'string'
          ? (property.value as boolean | number | string)
          : null,
      audio,
      autoMuted: muteValue !== null,
    }
    for (const field of ['min', 'max', 'step'] as const) {
      const number = Number(property[field])
      if (Number.isFinite(number)) descriptor[field] = number
    }
    if (Array.isArray(property.options)) {
      descriptor.options = property.options.slice(0, 64).flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const option = item as Record<string, unknown>
        const optionValue = option.value
        if (
          typeof optionValue !== 'boolean' &&
          typeof optionValue !== 'number' &&
          typeof optionValue !== 'string'
        )
          return []
        return [{ label: cleanText(option.label, '选项', 160), value: optionValue }]
      })
    }
    if (audio) audioCount += 1
    if (descriptor.autoMuted) mutedCount += 1
    output.push(descriptor)
  }
  return { properties: output, audioCount, mutedCount }
}

async function readManifest(
  projectRoot: string,
): Promise<{ file: string; stat: fs.Stats; project: Record<string, unknown> } | null> {
  const file = path.join(projectRoot, 'project.json')
  const stat = await statSafe(file)
  if (!stat?.isFile() || stat.size <= 0 || stat.size > MAX_PROJECT_JSON_BYTES) return null
  try {
    const [realRoot, realFile, text] = await Promise.all([
      fsp.realpath(projectRoot),
      fsp.realpath(file),
      fsp.readFile(file, 'utf8'),
    ])
    if (!isInside(realRoot, realFile)) return null
    const parsed = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { file: realFile, stat, project: parsed as Record<string, unknown> }
      : null
  } catch {
    return null
  }
}

async function indexProject(
  projectRoot: string,
  source: { kind: WallpaperEngineProject['source']; label: string },
  sceneOverride = '',
  manifestOverride?: ProjectManifest,
  dependency?: IndexedProject | null,
): Promise<IndexedProject | null> {
  const root = normalizePath(projectRoot)
  const manifest = manifestOverride ?? (await readManifest(root))
  if (!manifest) return null
  const project = manifest.project
  const declaredProjectType = safeProjectType(project.type)
  const projectType =
    declaredProjectType === 'unknown' && dependency ? dependency.item.projectType : declaredProjectType
  const directExt = path.extname(String(project.file ?? '')).toLowerCase()
  const mediaAllowed =
    declaredProjectType === 'video' ||
    declaredProjectType === 'image' ||
    (declaredProjectType === 'unknown' && SAFE_MIME.has(directExt))
  const ownMedia = mediaAllowed ? await firstProjectFile(root, [project.file], SAFE_MIME) : ''
  const media = ownMedia || dependency?.record.media || ''
  const mediaRoot = ownMedia ? root : dependency?.record.mediaRoot || root
  const sceneCandidate =
    declaredProjectType === 'scene'
      ? await firstProjectFile(
          root,
          [sceneOverride ? path.relative(root, sceneOverride) : '', project.file, 'scene.pkg', 'scene.pak'],
          new Map([...SCENE_EXTENSIONS].map((ext) => [ext, ext])),
        )
      : ''
  const ownScenePackage = await validScenePackage(sceneCandidate)
  const scenePackage = ownScenePackage || dependency?.record.scenePackage || ''
  const sceneRoot = ownScenePackage ? root : dependency?.record.sceneRoot || root
  const ownPreview = await firstProjectFile(
    root,
    [
      project.preview,
      project.cover,
      project.poster,
      'preview.jpg',
      'preview.jpeg',
      'preview.png',
      'preview.webp',
      'preview.gif',
      'cover.jpg',
      'cover.png',
      'cover.webp',
      'cover.gif',
    ],
    IMAGE_MIME,
  )
  const preview = ownPreview || dependency?.record.preview || ''
  const previewRoot = ownPreview ? root : dependency?.record.previewRoot || root
  if (!media && !preview && !scenePackage) return null
  const mediaExt = path.extname(media).toLowerCase()
  const previewExt = path.extname(preview).toLowerCase()
  const mediaType: WallpaperEngineProject['mediaType'] = VIDEO_MIME.has(mediaExt)
    ? 'video'
    : IMAGE_MIME.has(mediaExt)
      ? 'image'
      : null
  const propertyProject = declaredProjectType === 'scene' ? project : dependency?.record.project
  const propertyAnalysis = propertyProject
    ? analyzeProperties(propertyProject)
    : { properties: [], audioCount: 0, mutedCount: 0 }
  const workshopId = safeWorkshopId(project.workshopid ?? project.workshopId ?? project.publishedfileid)
  const dependencyWorkshopId = safeWorkshopId(project.dependency)
  const presetProperties = {
    ...(dependency?.record.presetProperties ?? {}),
    ...safePresetProperties(project.preset),
  }
  const id = opaqueId(root)
  const item: WallpaperEngineProject = {
    id,
    title: cleanText(project.title, path.basename(root)),
    projectType: projectType === 'unknown' && mediaType ? mediaType : projectType,
    mediaType,
    playable: Boolean(media),
    enginePlayable: Boolean(scenePackage),
    previewOnly: !media && !scenePackage,
    hasPreview: Boolean(preview),
    previewAnimated: previewExt === '.gif',
    source: source.kind,
    sourceLabel: source.label,
    workshopId,
    propertyCount: propertyAnalysis.properties.length,
    audioPropertyCount: propertyAnalysis.audioCount,
    mutedAudioPropertyCount: propertyAnalysis.mutedCount,
    updatedAt: Math.round(manifest.stat.mtimeMs || 0),
    safetyMode: media ? 'direct-media' : scenePackage ? 'native-engine' : 'preview-only',
    previewUrl: '',
    mediaUrl: '',
  }
  return {
    item,
    record: {
      id,
      projectRoot: root,
      projectFile: manifest.file,
      runtimeProjectFile: ownScenePackage
        ? manifest.file
        : dependency?.record.runtimeProjectFile || manifest.file,
      media,
      mediaRoot,
      preview,
      previewRoot,
      scenePackage,
      sceneRoot,
      workshopId,
      dependencyWorkshopId,
      presetProperties,
      project,
    },
  }
}

async function directProjectDirectories(container: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(container, { withFileTypes: true })
    const result: string[] = []
    for (const entry of entries.slice(0, MAX_PROJECTS)) {
      if (
        entry.isDirectory() &&
        (await statSafe(path.join(container, entry.name, 'project.json')))?.isFile()
      ) {
        result.push(path.join(container, entry.name))
      }
    }
    return result
  } catch {
    return []
  }
}

async function manualProjectDirectories(root: string): Promise<string[]> {
  const resolved = normalizePath(root)
  if (!resolved || !(await directoryExists(resolved))) return []
  if ((await statSafe(path.join(resolved, 'project.json')))?.isFile()) return [resolved]
  const output: string[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: resolved, depth: 0 }]
  let visited = 0
  while (queue.length && visited < MAX_MANUAL_SCAN_DIRS) {
    const current = queue.shift()!
    let entries: fs.Dirent[] = []
    try {
      entries = await fsp.readdir(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    visited += entries.length
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        /^\./.test(entry.name) ||
        /^(?:node_modules|cache|temp|tmp)$/i.test(entry.name)
      )
        continue
      const child = path.join(current.dir, entry.name)
      if ((await statSafe(path.join(child, 'project.json')))?.isFile()) output.push(child)
      else if (current.depth < 2) queue.push({ dir: child, depth: current.depth + 1 })
      if (visited >= MAX_MANUAL_SCAN_DIRS) break
    }
  }
  return output
}

function knownContainers(root: string): string[] {
  return [
    path.join(root, 'steamapps', 'workshop', 'content', WALLPAPER_ENGINE_APP_ID),
    path.join(root, 'steamapps', 'common', 'wallpaper_engine', 'projects', 'myprojects'),
  ]
}

async function findWallpaperEngineExecutable(libraries: readonly string[]): Promise<string> {
  if (process.platform !== 'win32') return ''
  const names =
    process.arch === 'ia32' ? ['wallpaper32.exe', 'wallpaper64.exe'] : ['wallpaper64.exe', 'wallpaper32.exe']
  for (const library of libraries) {
    for (const name of names) {
      for (const candidate of [
        path.join(library, 'steamapps', 'common', 'wallpaper_engine', name),
        path.join(library, 'steamapps', 'common', 'wallpaper_engine', 'bin', name),
      ]) {
        try {
          const real = await fsp.realpath(candidate)
          if ((await fsp.stat(real)).isFile() && path.basename(real).toLowerCase() === name) return real
        } catch {
          // The runtime is optional and may be installed in another Steam library.
        }
      }
    }
  }
  return ''
}

function projectSource(root: string): { kind: WallpaperEngineProject['source']; label: string } {
  return /workshop[\\/]content/i.test(root)
    ? { kind: 'workshop', label: 'Steam 创意工坊' }
    : { kind: 'local', label: 'Wallpaper Engine 本地项目' }
}

export interface WallpaperEngineLibraryOptions {
  userDataPath: string
  discoverLibraries?: () => Promise<string[]>
  onProjectUnavailable?: (id: string, error: string) => void
}

export class WallpaperEngineLibrary {
  readonly configPath: string
  private readonly discoverLibraries: () => Promise<string[]>
  private readonly onProjectUnavailable?: (id: string, error: string) => void
  private manualRoots: string[] = []
  private manualProjectFiles: string[] = []
  private index = new Map<string, ProjectRecord>()
  private snapshot: WallpaperEngineLibrarySnapshot | null = null
  private scanPromise: Promise<WallpaperEngineLibrarySnapshot> | null = null
  private readonly mediaToken = crypto.randomBytes(24).toString('hex')
  private disposed = false

  constructor(options: WallpaperEngineLibraryOptions) {
    this.configPath = path.join(normalizePath(options.userDataPath), CONFIG_FILE)
    this.discoverLibraries = options.discoverLibraries ?? discoverSteamLibraries
    this.onProjectUnavailable = options.onProjectUnavailable
    const config = this.readConfig()
    this.manualRoots = config.manualRoots
    this.manualProjectFiles = config.manualProjectFiles
  }

  private readConfig(): LibraryConfig {
    try {
      const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as Partial<LibraryConfig>
      return {
        version: 1,
        manualRoots: Array.isArray(raw.manualRoots)
          ? [...new Set(raw.manualRoots.map(normalizePath).filter(Boolean))].slice(0, 32)
          : [],
        manualProjectFiles: Array.isArray(raw.manualProjectFiles)
          ? [...new Set(raw.manualProjectFiles.map(normalizePath).filter(Boolean))].slice(0, 64)
          : [],
      }
    } catch {
      return { version: 1, manualRoots: [], manualProjectFiles: [] }
    }
  }

  private async saveConfig(): Promise<void> {
    await fsp.mkdir(path.dirname(this.configPath), { recursive: true })
    const temp = `${this.configPath}.tmp`
    await fsp.writeFile(
      temp,
      JSON.stringify(
        { version: 1, manualRoots: this.manualRoots, manualProjectFiles: this.manualProjectFiles },
        null,
        2,
      ),
      'utf8',
    )
    await fsp.rename(temp, this.configPath).catch(async () => {
      await fsp.copyFile(temp, this.configPath)
      await fsp.rm(temp, { force: true })
    })
  }

  private manualRootSummary(): WallpaperEngineManualRoot[] {
    return this.manualRoots.map((root) => ({
      id: opaqueId(root),
      name: path.basename(root) || path.parse(root).root || '导入目录',
    }))
  }

  private mediaUrl(kind: 'media' | 'preview', id: string): string {
    return `${WALLPAPER_ENGINE_SCHEME}://${kind}/${encodeURIComponent(id)}?token=${encodeURIComponent(this.mediaToken)}`
  }

  async list(force = false): Promise<WallpaperEngineLibrarySnapshot> {
    if (this.disposed) throw new Error('WALLPAPER_ENGINE_LIBRARY_DISPOSED')
    if (!force && this.snapshot && Date.now() - this.snapshot.scannedAt < CACHE_TTL_MS) return this.snapshot
    if (this.scanPromise) return this.scanPromise
    const scan = this.scan().finally(() => {
      if (this.scanPromise === scan) this.scanPromise = null
    })
    this.scanPromise = scan
    return this.scanPromise
  }

  private async scan(): Promise<WallpaperEngineLibrarySnapshot> {
    const startedAt = Date.now()
    const sources: Array<{
      root: string
      kind: WallpaperEngineProject['source']
      label: string
      direct: boolean
    }> = []
    const seenSources = new Set<string>()
    const libraries = await this.discoverLibraries()
    for (const library of libraries) {
      for (const root of knownContainers(library)) {
        if (!(await directoryExists(root))) continue
        const key = pathKey(root)
        if (seenSources.has(key)) continue
        seenSources.add(key)
        const source = projectSource(root)
        sources.push({ root, ...source, direct: true })
      }
    }
    for (const root of this.manualRoots) {
      if (!(await directoryExists(root))) continue
      const key = pathKey(root)
      if (seenSources.has(key)) continue
      seenSources.add(key)
      sources.push({ root, kind: 'imported', label: '手动导入', direct: false })
    }
    const projectRoots = new Map<
      string,
      { root: string; source: { kind: WallpaperEngineProject['source']; label: string } }
    >()
    const manualPackages = new Map<string, string>()
    for (const file of this.manualProjectFiles) manualPackages.set(pathKey(path.dirname(file)), file)
    for (const source of sources) {
      const roots = source.direct
        ? await directProjectDirectories(source.root)
        : await manualProjectDirectories(source.root)
      for (const root of roots) {
        if (projectRoots.size >= MAX_PROJECTS) break
        const key = pathKey(root)
        if (!projectRoots.has(key)) projectRoots.set(key, { root, source })
      }
      if (projectRoots.size >= MAX_PROJECTS) break
    }
    const manifests = new Map<string, ProjectManifest>()
    const rootByWorkshopId = new Map<string, string>()
    for (const [key, value] of projectRoots) {
      const manifest = await readManifest(value.root)
      if (!manifest) continue
      manifests.set(key, manifest)
      const directoryWorkshopId = safeWorkshopId(path.basename(value.root))
      const manifestWorkshopId = safeWorkshopId(
        manifest.project.workshopid ?? manifest.project.workshopId ?? manifest.project.publishedfileid,
      )
      if (directoryWorkshopId && !rootByWorkshopId.has(directoryWorkshopId)) {
        rootByWorkshopId.set(directoryWorkshopId, key)
      }
      if (manifestWorkshopId && !rootByWorkshopId.has(manifestWorkshopId)) {
        rootByWorkshopId.set(manifestWorkshopId, key)
      }
    }
    const indexedByRoot = new Map<string, IndexedProject | null>()
    const indexing = new Set<string>()
    const indexRoot = async (key: string): Promise<IndexedProject | null> => {
      if (indexedByRoot.has(key)) return indexedByRoot.get(key) ?? null
      if (indexing.has(key)) return null
      const value = projectRoots.get(key)
      const manifest = manifests.get(key)
      if (!value || !manifest) return null
      indexing.add(key)
      const dependencyWorkshopId = safeWorkshopId(manifest.project.dependency)
      const dependencyKey = dependencyWorkshopId ? rootByWorkshopId.get(dependencyWorkshopId) : undefined
      const dependency = dependencyKey && dependencyKey !== key ? await indexRoot(dependencyKey) : null
      const indexed = await indexProject(
        value.root,
        value.source,
        manualPackages.get(key) ?? '',
        manifest,
        dependency,
      )
      indexing.delete(key)
      indexedByRoot.set(key, indexed)
      return indexed
    }
    const nextIndex = new Map<string, ProjectRecord>()
    const projects: WallpaperEngineProject[] = []
    for (const key of projectRoots.keys()) {
      const indexed = await indexRoot(key)
      if (!indexed || nextIndex.has(indexed.item.id)) continue
      indexed.item.previewUrl = indexed.record.preview ? this.mediaUrl('preview', indexed.item.id) : ''
      indexed.item.mediaUrl = indexed.record.media ? this.mediaUrl('media', indexed.item.id) : ''
      nextIndex.set(indexed.item.id, indexed.record)
      projects.push(indexed.item)
    }
    projects.sort(
      (a, b) =>
        Number(b.playable) - Number(a.playable) ||
        Number(b.enginePlayable) - Number(a.enginePlayable) ||
        a.title.localeCompare(b.title, 'zh-CN'),
    )
    this.index = nextIndex
    const runtimeExecutable = await findWallpaperEngineExecutable(libraries)
    const runtime: WallpaperEngineRuntimeProbe = {
      available: Boolean(runtimeExecutable),
      reason: runtimeExecutable
        ? ''
        : process.platform === 'win32'
          ? 'WALLPAPER_ENGINE_NOT_INSTALLED'
          : 'WALLPAPER_ENGINE_WINDOWS_ONLY',
      executableName: runtimeExecutable ? path.basename(runtimeExecutable) : '',
    }
    const snapshot: WallpaperEngineLibrarySnapshot = {
      version: WALLPAPER_ENGINE_STATE_VERSION,
      ok: true,
      projects,
      count: projects.length,
      dynamicCount: projects.filter(
        (item) => item.enginePlayable || item.mediaType === 'video' || item.previewAnimated,
      ).length,
      enginePlayableCount: projects.filter((item) => item.enginePlayable).length,
      previewOnlyCount: projects.filter((item) => item.previewOnly).length,
      sourceCount: sources.length,
      manualRoots: this.manualRootSummary(),
      scannedAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
      runtime,
    }
    this.snapshot = snapshot
    return snapshot
  }

  async addManualRoot(root: string): Promise<WallpaperEngineLibrarySnapshot> {
    const resolved = normalizePath(root)
    if (!resolved || !(await directoryExists(resolved)))
      throw new Error('WALLPAPER_ENGINE_DIRECTORY_REQUIRED')
    if (!(await manualProjectDirectories(resolved)).length)
      throw new Error('WALLPAPER_ENGINE_NO_PROJECTS_FOUND')
    if (!this.manualRoots.some((item) => pathKey(item) === pathKey(resolved))) {
      this.manualRoots = [...this.manualRoots, resolved].slice(-32)
      await this.saveConfig()
    }
    return this.list(true)
  }

  async addManualProjectFile(file: string): Promise<WallpaperEngineLibrarySnapshot> {
    const resolved = normalizePath(file)
    const stat = await statSafe(resolved)
    if (!stat?.isFile()) throw new Error('WALLPAPER_ENGINE_PROJECT_FILE_REQUIRED')
    if (path.basename(resolved).toLowerCase() === 'project.json')
      return this.addManualRoot(path.dirname(resolved))
    if (!SCENE_EXTENSIONS.has(path.extname(resolved).toLowerCase()) || !(await validScenePackage(resolved))) {
      throw new Error('WALLPAPER_ENGINE_SCENE_PACKAGE_INVALID')
    }
    const root = path.dirname(resolved)
    const manifest = await readManifest(root)
    if (!manifest || safeProjectType(manifest.project.type) !== 'scene')
      throw new Error('WALLPAPER_ENGINE_SCENE_MANIFEST_INVALID')
    this.manualRoots = [...this.manualRoots.filter((item) => pathKey(item) !== pathKey(root)), root].slice(
      -32,
    )
    this.manualProjectFiles = [
      ...this.manualProjectFiles.filter((item) => pathKey(item) !== pathKey(resolved)),
      resolved,
    ].slice(-64)
    await this.saveConfig()
    return this.list(true)
  }

  async removeManualRoot(id: string): Promise<WallpaperEngineLibrarySnapshot> {
    const removed = this.manualRoots.filter((root) => opaqueId(root) === String(id))
    this.manualRoots = this.manualRoots.filter((root) => !removed.includes(root))
    this.manualProjectFiles = this.manualProjectFiles.filter(
      (file) => !removed.some((root) => isInside(root, file)),
    )
    await this.saveConfig()
    return this.list(true)
  }

  async getProjectDetails(id: string): Promise<WallpaperEngineProjectDetails> {
    const record = this.index.get(String(id).toLowerCase())
    if (!record) throw new Error('WALLPAPER_ENGINE_PROJECT_NOT_FOUND')
    const project = this.snapshot?.projects.find((item) => item.id === record.id)
    const analysis = analyzeProperties(record.project)
    return {
      ok: true,
      id: record.id,
      title: cleanText(record.project.title, path.basename(record.projectRoot)),
      projectType: project?.projectType ?? safeProjectType(record.project.type),
      workshopId: record.workshopId,
      propertyCount: analysis.properties.length,
      audioPropertyCount: analysis.audioCount,
      mutedAudioPropertyCount: analysis.mutedCount,
      properties: analysis.properties,
    }
  }

  async resolveSelection(id: string): Promise<WallpaperEngineSelection> {
    const normalizedId = String(id).toLowerCase()
    if (!/^[a-f0-9]{24}$/.test(normalizedId)) throw new Error('WALLPAPER_ENGINE_PROJECT_NOT_FOUND')
    if (!this.index.has(normalizedId)) await this.list(false)
    const record = this.index.get(normalizedId)
    const project = this.snapshot?.projects.find((item) => item.id === normalizedId)
    if (!record || !project) throw new Error('WALLPAPER_ENGINE_PROJECT_NOT_FOUND')
    if (!project.enginePlayable && !project.playable) {
      throw new Error('WALLPAPER_ENGINE_PROJECT_UNSUPPORTED')
    }
    return {
      version: WALLPAPER_ENGINE_STATE_VERSION,
      active: true,
      id: project.id,
      title: project.title,
      kind: project.enginePlayable ? 'engine' : 'media',
      mediaType: project.mediaType ?? 'image',
      projectType: project.projectType,
      updatedAt: project.updatedAt,
      runtimeError: '',
    }
  }

  async getProject(id: string): Promise<WallpaperEngineProject> {
    const normalizedId = String(id).toLowerCase()
    if (!this.index.has(normalizedId)) await this.list(false)
    const project = this.snapshot?.projects.find((item) => item.id === normalizedId)
    if (!project) throw new Error('WALLPAPER_ENGINE_PROJECT_NOT_FOUND')
    return { ...project }
  }

  async getNativeSceneTarget(id: string): Promise<{
    id: string
    projectFile: string
    scenePackage: string
    muteProperties: Record<string, number>
    presetProperties: Record<string, boolean | number | string>
  }> {
    const record = this.index.get(String(id).toLowerCase())
    if (!record || !record.scenePackage) throw new Error('WALLPAPER_ENGINE_SCENE_NOT_FOUND')
    const relativeScene = path.relative(record.sceneRoot, record.scenePackage)
    const scenePackage = await resolveProjectFile(
      record.sceneRoot,
      relativeScene,
      new Map([...SCENE_EXTENSIONS].map((ext) => [ext, ext])),
    )
    const _validated = await validScenePackage(scenePackage)
    if (!_validated)
      console.error('[WE-DIAG] scenePackage invalid:', {
        sceneRoot: record.sceneRoot,
        scenePackageStored: record.scenePackage,
        relativeScene,
        scenePackageResolved: scenePackage,
        ext: scenePackage ? path.extname(scenePackage) : '',
      })
    if (!_validated) throw new Error('WALLPAPER_ENGINE_SCENE_PACKAGE_INVALID')
    return {
      id: record.id,
      projectFile: record.runtimeProjectFile,
      scenePackage,
      muteProperties: { volume: 0 },
      presetProperties: { ...record.presetProperties },
    }
  }

  async mediaResponse(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('Not found', { status: 404 })
    }
    if (url.protocol !== `${WALLPAPER_ENGINE_SCHEME}:` || url.searchParams.get('token') !== this.mediaToken)
      return new Response('Not found', { status: 404 })
    let id = ''
    try {
      id = decodeURIComponent(url.pathname.replace(/^\/+/, '')).toLowerCase()
    } catch {
      return new Response('Not found', { status: 404 })
    }
    if (!/^[a-f0-9]{24}$/.test(id)) return new Response('Not found', { status: 404 })
    const record = this.index.get(id)
    if (!record) return new Response('Not found', { status: 404 })
    const target = url.hostname === 'media' ? record.media : url.hostname === 'preview' ? record.preview : ''
    const targetRoot =
      url.hostname === 'media' ? record.mediaRoot : url.hostname === 'preview' ? record.previewRoot : ''
    if (!target) return new Response('Not found', { status: 404 })
    let realRoot: string
    let realTarget: string
    try {
      ;[realRoot, realTarget] = await Promise.all([fsp.realpath(targetRoot), fsp.realpath(target)])
      if (!isInside(realRoot, realTarget) || !SAFE_MIME.has(path.extname(realTarget).toLowerCase())) {
        this.onProjectUnavailable?.(id, 'WALLPAPER_ENGINE_PROJECT_OFFLINE')
        return new Response('Not found', { status: 404 })
      }
    } catch {
      this.onProjectUnavailable?.(id, 'WALLPAPER_ENGINE_PROJECT_OFFLINE')
      return new Response('Not found', { status: 404 })
    }
    const stat = await statSafe(realTarget)
    if (!stat?.isFile()) {
      this.onProjectUnavailable?.(id, 'WALLPAPER_ENGINE_PROJECT_OFFLINE')
      return new Response('Not found', { status: 404 })
    }
    const range = parseByteRange(request.headers.get('range'), stat.size)
    if (range && 'invalid' in range)
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
    const start = range?.start ?? 0
    const end = range?.end ?? Math.max(0, stat.size - 1)
    const headers = new Headers({
      'Content-Type': SAFE_MIME.get(path.extname(realTarget).toLowerCase()) ?? 'application/octet-stream',
      'Content-Length': String(stat.size ? end - start + 1 : 0),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    })
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`)
    if (request.method === 'HEAD' || stat.size === 0)
      return new Response(null, { status: range ? 206 : 200, headers })
    const stream = fs.createReadStream(realTarget, { start, end })
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers })
  }

  getMediaToken(): string {
    return this.mediaToken
  }

  dispose(): void {
    this.disposed = true
    this.index.clear()
    this.snapshot = null
  }
}

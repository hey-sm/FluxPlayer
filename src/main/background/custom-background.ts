import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import {
  CUSTOM_BACKGROUND_SCHEME,
  CUSTOM_BACKGROUND_VERSION,
  IMAGE_BACKGROUND_EXTENSIONS,
  VIDEO_BACKGROUND_EXTENSIONS,
  type CustomBackground,
  type CustomBackgroundKind,
  type CustomBackgroundResult,
  type CustomBackgroundSource,
  type WallpaperEngineProject,
  type WallpaperEngineScanResult,
} from '@shared/custom-background-contract'

interface StoredBackground extends Omit<CustomBackground, 'url'> {
  fileName: string
}

interface ParsedWallpaperEngineProject {
  title: string
  mediaPath: string
  previewPath: string | null
}

export interface CustomBackgroundServiceOptions {
  userDataPath: string
  steamRoots?: () => readonly string[]
  now?: () => Date
  randomId?: () => string
}

const IMAGE_EXTENSIONS = new Set<string>(IMAGE_BACKGROUND_EXTENSIONS)
const VIDEO_EXTENSIONS = new Set<string>(VIDEO_BACKGROUND_EXTENSIONS)
const MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.gif': 'image/gif', '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.webm': 'video/webm',
}

function uniqueExistingDirectories(items: readonly string[]): string[] {
  return [...new Set(items.map((item) => path.resolve(item)))].filter((item) => {
    try { return fs.statSync(item).isDirectory() } catch { return false }
  })
}

function windowsSteamRegistryRoots(): string[] {
  if (process.platform !== 'win32') return []
  const roots: string[] = []
  for (const [key, value] of [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
  ] as const) {
    try {
      const output = execFileSync('reg.exe', ['query', key, '/v', value], { encoding: 'utf8', windowsHide: true })
      const match = output.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)$`, 'im'))
      if (match?.[1]) roots.push(match[1].trim())
    } catch { /* Registry key is optional. */ }
  }
  return roots
}

export function defaultSteamRoots(): string[] {
  const roots = [
    process.env.STEAM_PATH,
    ...windowsSteamRegistryRoots(),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)']!, 'Steam'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Steam'),
  ].filter((item): item is string => Boolean(item))
  return uniqueExistingDirectories(roots)
}

/** Parses only quoted Steam VDF keys named `path`; escaped backslashes are unescaped. */
export function parseSteamLibraryFoldersVdf(text: string): string[] {
  const libraries: string[] = []
  const pattern = /"path"\s+"((?:\\.|[^"\\])*)"/gi
  for (const match of text.matchAll(pattern)) {
    const value = match[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"').trim()
    if (value) libraries.push(path.resolve(value))
  }
  return [...new Set(libraries)]
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

export function parseWallpaperEngineProject(projectJsonPath: string): ParsedWallpaperEngineProject | null {
  try {
    const projectDirectory = path.dirname(path.resolve(projectJsonPath))
    const raw = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8')) as Record<string, unknown>
    if (typeof raw.type !== 'string' || raw.type.toLowerCase() !== 'video') return null
    if (typeof raw.file !== 'string' || !raw.file.trim()) return null
    const mediaPath = path.resolve(projectDirectory, raw.file)
    if (!isInside(projectDirectory, mediaPath) || !fs.statSync(mediaPath).isFile()) return null
    if (!VIDEO_EXTENSIONS.has(path.extname(mediaPath).toLowerCase())) return null
    const title = typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim().slice(0, 200)
      : path.basename(projectDirectory)
    const previewValue = typeof raw.preview === 'string' ? raw.preview.trim() : ''
    const previewCandidate = previewValue ? path.resolve(projectDirectory, previewValue) : ''
    const previewPath = previewCandidate && isInside(projectDirectory, previewCandidate) && fs.statSync(previewCandidate).isFile()
      ? previewCandidate
      : null
    return { title, mediaPath, previewPath }
  } catch {
    return null
  }
}

export class CustomBackgroundService {
  readonly backgroundsDirectory: string
  private readonly statePath: string
  private readonly getSteamRoots: () => readonly string[]
  private readonly now: () => Date
  private readonly randomId: () => string
  private current: StoredBackground | null = null
  private projects = new Map<string, ParsedWallpaperEngineProject>()

  constructor(options: CustomBackgroundServiceOptions) {
    this.backgroundsDirectory = path.join(options.userDataPath, 'backgrounds')
    this.statePath = path.join(this.backgroundsDirectory, 'current.json')
    this.getSteamRoots = options.steamRoots ?? defaultSteamRoots
    this.now = options.now ?? (() => new Date())
    this.randomId = options.randomId ?? (() => crypto.randomUUID())
    fs.mkdirSync(this.backgroundsDirectory, { recursive: true })
    this.current = this.readState()
  }

  getCurrent(): CustomBackground | null {
    return this.current ? this.toPublic(this.current) : null
  }

  importFile(sourcePath: string, source: CustomBackgroundSource = 'file', displayName?: string): CustomBackgroundResult {
    try {
      const absoluteSource = path.resolve(sourcePath)
      const stat = fs.statSync(absoluteSource)
      if (!stat.isFile()) return { ok: false, background: this.getCurrent(), error: 'BACKGROUND_FILE_REQUIRED' }
      const extension = path.extname(absoluteSource).toLowerCase()
      const kind = this.kindForExtension(extension)
      if (!kind) return { ok: false, background: this.getCurrent(), error: 'UNSUPPORTED_BACKGROUND_FORMAT' }

      const id = this.randomId()
      const fileName = `${id}${extension}`
      const destination = path.join(this.backgroundsDirectory, fileName)
      fs.copyFileSync(absoluteSource, destination, fs.constants.COPYFILE_EXCL)
      const previous = this.current
      const stored: StoredBackground = {
        version: CUSTOM_BACKGROUND_VERSION,
        id,
        kind,
        source,
        name: (displayName || path.basename(absoluteSource)).slice(0, 200),
        mimeType: MIME_TYPES[extension] || 'application/octet-stream',
        updatedAt: this.now().toISOString(),
        fileName,
      }
      try {
        this.writeState(stored)
        this.current = stored
        this.removeManagedFile(previous)
      } catch (error) {
        fs.rmSync(destination, { force: true })
        throw error
      }
      return { ok: true, background: this.toPublic(stored) }
    } catch (error) {
      return { ok: false, background: this.getCurrent(), error: error instanceof Error ? error.message : 'BACKGROUND_IMPORT_FAILED' }
    }
  }

  clear(): CustomBackgroundResult {
    const previous = this.current
    try {
      fs.rmSync(this.statePath, { force: true })
      this.current = null
      this.removeManagedFile(previous)
      return { ok: true, background: null }
    } catch (error) {
      return { ok: false, background: this.getCurrent(), error: error instanceof Error ? error.message : 'BACKGROUND_CLEAR_FAILED' }
    }
  }

  scanWallpaperEngine(): WallpaperEngineScanResult {
    const found = new Map<string, ParsedWallpaperEngineProject>()
    try {
      for (const library of this.findSteamLibraries()) {
        const contentDirectory = path.join(library, 'steamapps', 'workshop', 'content', '431960')
        let entries: fs.Dirent[]
        try { entries = fs.readdirSync(contentDirectory, { withFileTypes: true }) } catch { continue }
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const projectPath = path.join(contentDirectory, entry.name, 'project.json')
          const project = parseWallpaperEngineProject(projectPath)
          if (!project) continue
          const id = crypto.createHash('sha256').update(path.resolve(projectPath)).digest('hex').slice(0, 24)
          found.set(id, project)
        }
      }
      this.projects = found
      const projects: WallpaperEngineProject[] = [...found].map(([id, project]) => ({
        id, title: project.title, kind: 'video' as const,
        previewUrl: project.previewPath ? `${CUSTOM_BACKGROUND_SCHEME}://preview/${encodeURIComponent(id)}` : '',
      })).sort((a, b) => a.title.localeCompare(b.title))
      return { ok: true, projects }
    } catch (error) {
      this.projects.clear()
      return { ok: false, projects: [], error: error instanceof Error ? error.message : 'WALLPAPER_ENGINE_SCAN_FAILED' }
    }
  }

  importScannedProject(projectId: string): CustomBackgroundResult {
    const project = this.projects.get(projectId)
    if (!project) return { ok: false, background: this.getCurrent(), error: 'WALLPAPER_ENGINE_PROJECT_NOT_FOUND' }
    return this.importFile(project.mediaPath, 'wallpaper-engine', project.title)
  }

  importProjectPath(selectedPath: string): CustomBackgroundResult {
    let projectJsonPath = path.resolve(selectedPath)
    try {
      if (fs.statSync(projectJsonPath).isDirectory()) projectJsonPath = path.join(projectJsonPath, 'project.json')
    } catch {
      return { ok: false, background: this.getCurrent(), error: 'WALLPAPER_ENGINE_PROJECT_NOT_FOUND' }
    }
    const project = parseWallpaperEngineProject(projectJsonPath)
    if (!project) return { ok: false, background: this.getCurrent(), error: 'UNSUPPORTED_WALLPAPER_ENGINE_PROJECT' }
    return this.importFile(project.mediaPath, 'wallpaper-engine', project.title)
  }

  resolveRequestUrl(requestUrl: string): string | null {
    try {
      const url = new URL(requestUrl)
      if (url.protocol !== `${CUSTOM_BACKGROUND_SCHEME}:`) return null
      const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (url.hostname === 'preview') {
        const previewPath = this.projects.get(id)?.previewPath
        return previewPath ? pathToFileURL(previewPath).href : null
      }
      if (url.hostname !== 'media' || !this.current || id !== this.current.id) return null
      const filePath = path.join(this.backgroundsDirectory, this.current.fileName)
      if (!isInside(this.backgroundsDirectory, filePath) || !fs.statSync(filePath).isFile()) return null
      return pathToFileURL(filePath).href
    } catch {
      return null
    }
  }

  private findSteamLibraries(): string[] {
    const roots = uniqueExistingDirectories(this.getSteamRoots())
    const libraries = new Set(roots)
    for (const root of roots) {
      try {
        const text = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')
        for (const library of parseSteamLibraryFoldersVdf(text)) libraries.add(library)
      } catch { /* Steam may not be installed in this root. */ }
    }
    return [...libraries]
  }

  private kindForExtension(extension: string): CustomBackgroundKind | null {
    if (IMAGE_EXTENSIONS.has(extension)) return 'image'
    if (VIDEO_EXTENSIONS.has(extension)) return 'video'
    return null
  }

  private toPublic(stored: StoredBackground): CustomBackground {
    const { fileName, ...background } = stored
    void fileName
    return { ...background, url: `${CUSTOM_BACKGROUND_SCHEME}://media/${encodeURIComponent(stored.id)}` }
  }

  private readState(): StoredBackground | null {
    try {
      const value = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as StoredBackground
      if (value.version !== CUSTOM_BACKGROUND_VERSION || typeof value.id !== 'string' || typeof value.fileName !== 'string') return null
      const filePath = path.join(this.backgroundsDirectory, value.fileName)
      if (!isInside(this.backgroundsDirectory, filePath) || !fs.statSync(filePath).isFile()) return null
      if (!this.kindForExtension(path.extname(filePath).toLowerCase())) return null
      return value
    } catch { return null }
  }

  private writeState(value: StoredBackground): void {
    const temporary = `${this.statePath}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(temporary, this.statePath)
  }

  private removeManagedFile(value: StoredBackground | null): void {
    if (!value) return
    const filePath = path.join(this.backgroundsDirectory, value.fileName)
    if (isInside(this.backgroundsDirectory, filePath)) fs.rmSync(filePath, { force: true })
  }
}

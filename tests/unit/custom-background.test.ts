import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CustomBackgroundService,
  parseSteamLibraryFoldersVdf,
  parseWallpaperEngineProject,
} from '../../src/main/background/custom-background'

const temporaryDirectories: string[] = []
function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-background-'))
  temporaryDirectories.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function writeFile(filePath: string, content = 'media'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

describe('CustomBackgroundService', () => {
  it('copies supported media into userData and exposes no absolute path', () => {
    const root = temporaryDirectory()
    const source = path.join(root, 'outside', 'photo.png')
    writeFile(source)
    const service = new CustomBackgroundService({
      userDataPath: path.join(root, 'user-data'), randomId: () => 'asset-id',
      now: () => new Date('2026-07-11T00:00:00.000Z'),
    })

    const result = service.importFile(source)
    expect(result).toEqual({ ok: true, background: {
      version: 1, id: 'asset-id', kind: 'image', source: 'file', name: 'photo.png',
      mimeType: 'image/png', url: 'flux-background://media/asset-id',
      updatedAt: '2026-07-11T00:00:00.000Z',
    } })
    expect(fs.readFileSync(path.join(root, 'user-data', 'backgrounds', 'asset-id.png'), 'utf8')).toBe('media')
    expect(JSON.stringify(result)).not.toContain(path.resolve(root))
    expect(service.resolveRequestUrl('flux-background://media/asset-id')).toMatch(/^file:/)
    expect(service.resolveRequestUrl('flux-background://media/not-current')).toBeNull()
  })

  it('clears metadata and the managed copy', () => {
    const root = temporaryDirectory()
    const source = path.join(root, 'video.mp4')
    writeFile(source)
    const service = new CustomBackgroundService({ userDataPath: path.join(root, 'data'), randomId: () => 'video-id' })
    service.importFile(source)

    expect(service.clear()).toEqual({ ok: true, background: null })
    expect(fs.existsSync(path.join(root, 'data', 'backgrounds', 'video-id.mp4'))).toBe(false)
    expect(service.getCurrent()).toBeNull()
  })

  it('scans Steam libraries and imports only directly parseable video projects', () => {
    const root = temporaryDirectory()
    const steam = path.join(root, 'Steam')
    const library = path.join(root, 'Library')
    writeFile(path.join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" { "1" { "path" "${library.replace(/\\/g, '\\\\')}" } }`)
    const workshop = path.join(library, 'steamapps', 'workshop', 'content', '431960')
    writeFile(path.join(workshop, '100', 'wallpaper.mp4'))
    writeFile(path.join(workshop, '100', 'project.json'), JSON.stringify({ type: 'Video', title: 'Ocean', file: 'wallpaper.mp4' }))
    writeFile(path.join(workshop, '200', 'index.html'))
    writeFile(path.join(workshop, '200', 'project.json'), JSON.stringify({ type: 'Web', title: 'Rejected', file: 'index.html' }))
    const service = new CustomBackgroundService({ userDataPath: path.join(root, 'data'), steamRoots: () => [steam], randomId: () => 'we-id' })

    const scan = service.scanWallpaperEngine()
    expect(scan.ok).toBe(true)
    expect(scan.projects).toHaveLength(1)
    expect(scan.projects[0]).toMatchObject({ title: 'Ocean', kind: 'video' })
    expect(JSON.stringify(scan)).not.toContain(library)
    expect(service.importScannedProject(scan.projects[0].id).background).toMatchObject({
      id: 'we-id', source: 'wallpaper-engine', kind: 'video', name: 'Ocean',
    })
  })

  it('supports manual directory/project.json import and rejects escaping media paths', () => {
    const root = temporaryDirectory()
    const project = path.join(root, 'project')
    writeFile(path.join(project, 'clip.webm'))
    writeFile(path.join(project, 'project.json'), JSON.stringify({ type: 'video', file: 'clip.webm' }))
    const service = new CustomBackgroundService({ userDataPath: path.join(root, 'data'), randomId: () => 'manual-id' })
    expect(service.importProjectPath(project).ok).toBe(true)

    writeFile(path.join(root, 'outside.mp4'))
    writeFile(path.join(project, 'project.json'), JSON.stringify({ type: 'video', file: '../outside.mp4' }))
    expect(parseWallpaperEngineProject(path.join(project, 'project.json'))).toBeNull()
  })
})

describe('Steam VDF parser', () => {
  it('extracts and deduplicates escaped library paths', () => {
    expect(parseSteamLibraryFoldersVdf('"path" "D:\\\\Steam"\n"path" "D:\\\\Steam"')).toEqual([path.resolve('D:\\Steam')])
  })
})

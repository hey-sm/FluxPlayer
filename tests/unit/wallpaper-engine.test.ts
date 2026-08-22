import fs from 'node:fs'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { WallpaperEngineLibrary } from '../../src/main/background/wallpaper-engine-library'
import {
  DwmRuntimeAdapter,
  WallpaperEngineRuntime,
  type WallpaperEngineRuntimeAdapter,
  type WallpaperEngineNativeSceneTarget,
} from '../../src/main/background/wallpaper-engine-runtime'
import {
  prepareSilentSceneProject,
  readWallpaperPackageScene,
} from '../../src/main/background/wallpaper-engine-scene-cache'
import type {
  WallpaperEngineProject,
  WallpaperEngineSelection,
} from '../../src/shared/wallpaper-engine-contract'
import {
  WallpaperEngineStore,
  resetLegacyBackgroundStorage,
} from '../../src/main/background/wallpaper-engine-store'

const temporaryDirectories: string[] = []

const nativeHelperSource = fs.readFileSync(path.resolve('native/wallpaper-engine-helper/Program.cs'), 'utf8')

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-wallpaper-engine-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('Wallpaper Engine native helper lifecycle', () => {
  it('closes only the verified Scene source when the helper exits', () => {
    expect(nativeHelperSource).toContain('CloseVerifiedSourceWindow();')
    expect(nativeHelperSource).toMatch(
      /ValidateIdentity\([\s\S]*?options\.SourceWindow[\s\S]*?NativeMethods\.PostMessageW\([\s\S]*?NativeMethods\.WM_CLOSE/,
    )
    expect(nativeHelperSource).toMatch(/catch \{ \}\s*Close\(\);/)
  })

  it('runs the helper outside the main process job so parent-loss cleanup can run', () => {
    const runtimeSource = fs.readFileSync(
      path.resolve('src/main/background/wallpaper-engine-runtime.ts'),
      'utf8',
    )
    expect(runtimeSource).toMatch(/spawn\(executable, \[\], \{[\s\S]*detached: true/)
  })
})

function writeFile(filePath: string, content: string | Uint8Array): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function packageString(value: string): Buffer {
  const encoded = Buffer.from(value, 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32LE(encoded.length)
  return Buffer.concat([length, encoded])
}

function scenePackage(scene: Record<string, unknown>): Buffer {
  const sceneJson = Buffer.from(JSON.stringify(scene), 'utf8')
  const count = Buffer.alloc(4)
  count.writeUInt32LE(1)
  const offset = Buffer.alloc(4)
  offset.writeUInt32LE(0)
  const length = Buffer.alloc(4)
  length.writeUInt32LE(sceneJson.length)
  return Buffer.concat([
    packageString('PKGV0001'),
    count,
    packageString('scene.json'),
    offset,
    length,
    sceneJson,
  ])
}

const MEDIA_PROJECT: WallpaperEngineProject = {
  id: '0123456789abcdef01234567',
  title: 'Video',
  projectType: 'video',
  mediaType: 'video',
  playable: true,
  enginePlayable: false,
  previewOnly: false,
  hasPreview: false,
  previewAnimated: false,
  source: 'local',
  sourceLabel: 'test',
  workshopId: '',
  propertyCount: 0,
  audioPropertyCount: 0,
  mutedAudioPropertyCount: 0,
  updatedAt: 0,
  safetyMode: 'direct-media',
  previewUrl: '',
  mediaUrl: 'flux-wallpaper://media/video?token=test',
}

const MEDIA_SELECTION: WallpaperEngineSelection = {
  version: 1,
  active: true,
  id: MEDIA_PROJECT.id,
  title: MEDIA_PROJECT.title,
  kind: 'media',
  mediaType: 'video',
  projectType: 'video',
  updatedAt: 0,
  runtimeError: '',
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('WallpaperEngineLibrary', () => {
  it('indexes media without exposing paths and serves tokenized range requests', async () => {
    const root = temporaryDirectory()
    const libraryRoot = path.join(root, 'library')
    const projectRoot = path.join(libraryRoot, 'steamapps', 'workshop', 'content', '431960', '100')
    writeFile(path.join(projectRoot, 'wallpaper.mp4'), '0123456789')
    writeFile(path.join(projectRoot, 'preview.jpg'), 'preview')
    writeFile(
      path.join(projectRoot, 'project.json'),
      JSON.stringify({ type: 'video', title: 'Ocean', file: 'wallpaper.mp4', preview: 'preview.jpg' }),
    )
    const unavailable: string[] = []
    const library = new WallpaperEngineLibrary({
      userDataPath: path.join(root, 'data'),
      discoverLibraries: async () => [libraryRoot],
      onProjectUnavailable: (id) => unavailable.push(id),
    })

    const snapshot = await library.list()
    expect(snapshot.projects).toHaveLength(1)
    const project = snapshot.projects[0]
    expect(project).toMatchObject({ title: 'Ocean', mediaType: 'video', playable: true })
    expect(JSON.stringify(snapshot)).not.toContain(path.resolve(projectRoot))

    writeFile(
      path.join(projectRoot, 'project.json'),
      JSON.stringify({
        type: 'video',
        title: 'Ocean Updated',
        file: 'wallpaper.mp4',
        preview: 'preview.jpg',
      }),
    )
    expect((await library.list(true)).projects[0].title).toBe('Ocean Updated')

    const response = await library.mediaResponse(
      new Request(project.mediaUrl, {
        headers: { Range: 'bytes=2-5' },
      }),
    )
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await response.text()).toBe('2345')

    const blocked = await library.mediaResponse(
      new Request(`flux-wallpaper://media/${project.id}?token=wrong`),
    )
    expect(blocked.status).toBe(404)

    fs.rmSync(path.join(projectRoot, 'wallpaper.mp4'))
    expect((await library.mediaResponse(new Request(project.mediaUrl))).status).toBe(404)
    expect(unavailable).toEqual([project.id])
  })

  it('rejects project paths escaping their root and validates PKGV scene packages', async () => {
    const root = temporaryDirectory()
    const projectRoot = path.join(root, 'manual')
    writeFile(path.join(root, 'outside.mp4'), 'outside')
    const escapingRoot = path.join(projectRoot, 'escaping')
    writeFile(
      path.join(escapingRoot, 'project.json'),
      JSON.stringify({ type: 'video', file: '../../outside.mp4' }),
    )
    writeFile(path.join(projectRoot, 'scene.pkg'), Buffer.from('PKGV0001scene'))
    writeFile(path.join(projectRoot, 'project.json'), JSON.stringify({ type: 'scene', file: 'scene.pkg' }))
    const library = new WallpaperEngineLibrary({
      userDataPath: path.join(root, 'data'),
      discoverLibraries: async () => [],
    })
    await library.addManualRoot(root)
    const snapshot = await library.list(true)
    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.projects[0].enginePlayable).toBe(true)
    expect(snapshot.projects[0].mediaUrl).toBe('')
  })

  it('resolves Wallpaper Engine dependency presets to their animated Scene runtime', async () => {
    const root = temporaryDirectory()
    const libraryRoot = path.join(root, 'library')
    const workshopRoot = path.join(libraryRoot, 'steamapps', 'workshop', 'content', '431960')
    const baseRoot = path.join(workshopRoot, '2989123185')
    const presetRoot = path.join(workshopRoot, '3029112301')
    writeFile(path.join(baseRoot, 'preview.jpg'), 'base preview')
    writeFile(path.join(baseRoot, 'scene.pkg'), scenePackage({ objects: [] }))
    writeFile(
      path.join(baseRoot, 'project.json'),
      JSON.stringify({
        type: 'scene',
        title: 'AI 绿叶少女',
        workshopid: '2989123185',
        file: 'scene.json',
        preview: 'preview.jpg',
      }),
    )
    writeFile(path.join(presetRoot, 'preview.jpg'), 'preset preview')
    writeFile(
      path.join(presetRoot, 'project.json'),
      JSON.stringify({
        dependency: '2989123185',
        title: '绿叶少女调色',
        preset: { rain: true, rate: 100, schemecolor: '0.4 0.5 0.3' },
        preview: 'preview.jpg',
      }),
    )
    const library = new WallpaperEngineLibrary({
      userDataPath: path.join(root, 'data'),
      discoverLibraries: async () => [libraryRoot],
    })

    const snapshot = await library.list()
    const preset = snapshot.projects.find((project) => project.title === '绿叶少女调色')
    expect(preset).toMatchObject({
      projectType: 'scene',
      enginePlayable: true,
      previewOnly: false,
      safetyMode: 'native-engine',
    })
    expect(snapshot.dynamicCount).toBe(2)
    let target
    try {
      target = await library.getNativeSceneTarget(preset!.id)
    } catch (error) {
      // 诊断：列出 baseRoot 下的文件和 scene.pkg 的前 12 字节
      const files = fs.readdirSync(baseRoot)
      const pkgPath = path.join(baseRoot, 'scene.pkg')
      const stat = fs.statSync(pkgPath)
      const header = Buffer.alloc(12)
      const fd = fs.openSync(pkgPath, 'r')
      fs.readSync(fd, header, 0, 12, 0)
      fs.closeSync(fd)
      const realBase = fs.realpathSync(baseRoot)
      const realPkg = fs.realpathSync(pkgPath)
      const fd2 = fs.openSync(realPkg, 'r')
      const header2 = Buffer.alloc(12)
      fs.readSync(fd2, header2, 0, 12, 0)
      fs.closeSync(fd2)
      throw new Error(
        'getNativeSceneTarget failed: ' +
          (error instanceof Error ? error.message : String(error)) +
          '\nbaseRoot: ' +
          baseRoot +
          '\nrealpath(baseRoot): ' +
          realBase +
          '\npkgPath: ' +
          pkgPath +
          '\nrealpath(pkgPath): ' +
          realPkg +
          '\nfiles in baseRoot: ' +
          JSON.stringify(files) +
          '\nscene.pkg size: ' +
          stat.size +
          '\nscene.pkg header: ' +
          JSON.stringify(header.toString('ascii')) +
          '\nscene.pkg hex: ' +
          header.toString('hex') +
          '\nrealpath header: ' +
          JSON.stringify(header2.toString('ascii')) +
          '\nrealpath hex: ' +
          header2.toString('hex'),
        { cause: error },
      )
    }
    expect(target.projectFile).toBe(path.join(baseRoot, 'project.json'))
    expect(target.presetProperties).toMatchObject({ rain: true, rate: 100 })
  })
})

describe('WallpaperEngineStore migration and runtime', () => {
  it('creates a verified silent Scene cache without modifying the source package', async () => {
    const root = temporaryDirectory()
    const projectFile = path.join(root, 'source', 'project.json')
    const sourcePackage = path.join(root, 'source', 'scene.pkg')
    const sourceBytes = scenePackage({
      objects: [
        { name: 'music', sound: ['audio/music.ogg'], startsilent: false, volume: 0.8 },
        { name: 'visual-only', volume: 0.6 },
      ],
    })
    writeFile(projectFile, JSON.stringify({ type: 'scene', title: 'Silent test', file: 'scene.pkg' }))
    writeFile(sourcePackage, sourceBytes)

    const cached = await prepareSilentSceneProject({
      cacheRoot: path.join(root, 'cache'),
      projectFile,
      scenePackage: sourcePackage,
    })
    const parsed = await readWallpaperPackageScene(cached.scenePackage)
    const objects = parsed.scene.objects as Array<Record<string, unknown>>

    expect(cached.audioObjectCount).toBe(1)
    expect(objects[0]).toMatchObject({ startsilent: true, volume: 0 })
    expect(objects[1]).toMatchObject({ volume: 0.6 })
    expect(fs.readFileSync(sourcePackage)).toEqual(sourceBytes)
    expect(JSON.parse(fs.readFileSync(cached.projectFile, 'utf8'))).toMatchObject({
      type: 'scene',
      file: 'scene.pkg',
    })
  })

  it('moves managed background storage to a recoverable backup once', () => {
    const root = temporaryDirectory()
    const backgrounds = path.join(root, 'backgrounds')
    writeFile(path.join(backgrounds, 'current.json'), '{}')
    writeFile(path.join(backgrounds, 'managed.mp4'), 'media')
    const backup = resetLegacyBackgroundStorage(root)
    expect(backup).toBeTruthy()
    expect(fs.existsSync(backup!)).toBe(true)
    expect(fs.existsSync(backgrounds)).toBe(false)
    expect(resetLegacyBackgroundStorage(root)).toBeNull()
  })

  it('uses a generation-safe media runtime for direct media', async () => {
    const runtime = new WallpaperEngineRuntime({
      userDataPath: temporaryDirectory(),
      discoverLibraries: async () => [],
    })
    await expect(runtime.activate(MEDIA_PROJECT, MEDIA_SELECTION)).resolves.toMatchObject({
      active: true,
      mode: 'media',
      projectId: MEDIA_PROJECT.id,
    })
    await runtime.stop()
    expect(runtime.getStatus().active).toBe(false)
    await runtime.dispose()
  })

  it('keeps a DWM session in starting until the helper activation is acknowledged', async () => {
    let releaseActivation: () => void = () => undefined
    let activationSessionId = ''
    const activationBarrier = new Promise<void>((resolve) => {
      releaseActivation = resolve
    })
    const adapter: WallpaperEngineRuntimeAdapter = {
      mode: 'dwm',
      canHandle: async () => true,
      start: async () => undefined,
      activateSurface: async (sessionId) => {
        activationSessionId = sessionId
        await activationBarrier
      },
      stop: async () => undefined,
    }
    const runtime = new WallpaperEngineRuntime({
      userDataPath: temporaryDirectory(),
      adapters: [adapter],
    })

    const starting = await runtime.activate(MEDIA_PROJECT, {
      ...MEDIA_SELECTION,
      kind: 'engine',
      projectType: 'scene',
    })
    expect(starting).toMatchObject({
      active: false,
      mode: 'dwm',
      phase: 'starting',
      glassSamplerAvailable: true,
    })
    await expect(runtime.activateDwmSurface('stale-session')).resolves.toBe(false)
    const activation = runtime.activateDwmSurface(starting.sessionId)
    expect(activationSessionId).toBe(starting.sessionId)
    expect(runtime.getStatus().phase).toBe('starting')
    releaseActivation()
    await expect(activation).resolves.toBe(true)
    expect(runtime.getStatus()).toMatchObject({ active: true, mode: 'dwm', phase: 'active' })
    await runtime.dispose()
  })

  it('starts a verified Scene in a unique window with location-scoped mute and cleanup', async () => {
    const root = temporaryDirectory()
    const libraryRoot = path.join(root, 'steam')
    const executable = path.join(
      libraryRoot,
      'steamapps',
      'common',
      'wallpaper_engine',
      process.arch === 'ia32' ? 'wallpaper32.exe' : 'wallpaper64.exe',
    )
    const projectFile = path.join(root, 'project', 'project.json')
    const sceneFile = path.join(root, 'project', 'scene.pkg')
    const sourceBytes = scenePackage({ objects: [{ sound: 'audio.ogg', startsilent: false, volume: 1 }] })
    writeFile(executable, 'signed-engine-placeholder')
    writeFile(projectFile, JSON.stringify({ type: 'scene', file: 'scene.pkg' }))
    writeFile(sceneFile, sourceBytes)
    const project: WallpaperEngineProject = {
      ...MEDIA_PROJECT,
      title: 'Scene',
      projectType: 'scene',
      mediaType: null,
      playable: false,
      enginePlayable: true,
      previewOnly: false,
      mediaUrl: '',
      previewUrl: 'flux-wallpaper://preview/scene?token=test',
      safetyMode: 'native-engine',
    }
    const selection: WallpaperEngineSelection = {
      ...MEDIA_SELECTION,
      title: 'Scene',
      kind: 'engine',
      mediaType: 'image',
      projectType: 'scene',
    }
    const target: WallpaperEngineNativeSceneTarget = {
      id: project.id,
      projectFile,
      scenePackage: sceneFile,
      muteProperties: { volume: 0 },
      presetProperties: { rain: true, volume: 0.75 },
    }
    const commands: string[][] = []
    let verificationCount = 0
    const helperPath = path.join(root, 'FluxPlayer.WallpaperEngine.Helper.exe')
    writeFile(helperPath, 'verified-helper-placeholder')
    writeFile(
      `${helperPath}.sha256`,
      crypto.createHash('sha256').update(fs.readFileSync(helperPath)).digest('hex'),
    )
    const helper = new EventEmitter() as EventEmitter & {
      stdin: PassThrough
      stdout: PassThrough
      stderr: PassThrough
      exitCode: number | null
      kill(): boolean
    }
    helper.stdin = new PassThrough()
    helper.stdout = new PassThrough()
    helper.stderr = new PassThrough()
    helper.exitCode = null
    helper.kill = () => {
      helper.exitCode = 0
      helper.emit('exit', 0)
      return true
    }
    const helperCommands: string[] = []
    helper.stdin.on('data', (chunk) => {
      const command = String(chunk)
      helperCommands.push(command.trim())
      if (command.startsWith('START\t')) {
        helper.stdout.write(
          '{"ok":true,"ready":true,"surfaceWindowHandle":5252,"surfaceTitle":"FluxPlayer WE DWM Surface session"}\n',
        )
      } else if (command.trim() === 'D') {
        helper.stdout.write('{"ok":true,"active":true,"surfaceWindowHandle":5252}\n')
      } else if (command.trim() === 'Q') helper.kill()
    })
    const adapter = new DwmRuntimeAdapter({
      userDataPath: path.join(root, 'data'),
      platform: 'win32',
      arch: 'x64',
      discoverLibraries: async () => [libraryRoot],
      resolveNativeSceneTarget: async () => target,
      captureSources: async () => {
        const open = commands.find((args) => args.includes('openWallpaper'))
        const location = open ? open[open.indexOf('-playInWindow') + 1] : ''
        return [
          { id: 'window:4242:0', name: location },
          { id: 'window:5252:0', name: 'FluxPlayer WE DWM Surface session' },
        ]
      },
      verifyExecutable: async () => {
        verificationCount += 1
        return true
      },
      resolveHost: () => ({
        windowHandle: '1111',
        executable: process.execPath,
        bounds: { x: 3839, y: 2159, width: 1280, height: 720 },
      }),
      helperPath,
      helperSpawn: () => helper as unknown as ChildProcessWithoutNullStreams,
      runControl: async (_file, args) => {
        commands.push(args)
      },
    })

    await adapter.start(project, selection, 'session')
    const open = commands[0]
    const location = open[open.indexOf('-playInWindow') + 1]
    expect(open.slice(0, 3)).toEqual(['-control', 'openWallpaper', '-file'])
    expect(location).toContain('FluxPlayer Wallpaper')
    expect(open.slice(open.indexOf('-width'), open.indexOf('-borderless'))).toEqual([
      '-width',
      '1280',
      '-height',
      '720',
      '-x',
      '3839',
      '-y',
      '2159',
    ])
    expect(verificationCount).toBe(1)
    expect(commands[1]).toContain('applyProperties')
    const properties = commands[1][commands[1].indexOf('-properties') + 1]
    expect(properties).toBe('RAW~({"rain":true,"volume":0})~END')
    expect(helperCommands).not.toContain('D')
    await expect(adapter.takeGlassSamplerSource('session')).resolves.toEqual({
      id: 'window:5252:0',
      name: 'FluxPlayer WE DWM Surface session',
    })
    await expect(adapter.activateSurface('session')).resolves.toBeUndefined()
    expect(helperCommands).toContain('D')
    await expect(adapter.takeGlassSamplerSource('session')).resolves.toBeNull()
    await adapter.stop()
    expect(commands.at(-1)).toEqual(['-control', 'closeWallpaper', '-location', location])
    expect(fs.readFileSync(sceneFile)).toEqual(sourceBytes)
  })

  it('stops a superseded adapter start before it can become active', async () => {
    let releaseStart: () => void = () => undefined
    let reportStarted: () => void = () => undefined
    const startBarrier = new Promise<void>((resolve) => {
      releaseStart = resolve
    })
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve
    })
    let stopCount = 0
    const adapter: WallpaperEngineRuntimeAdapter = {
      mode: 'media',
      canHandle: async () => true,
      start: async () => {
        reportStarted()
        await startBarrier
      },
      stop: async () => {
        stopCount += 1
      },
    }
    const runtime = new WallpaperEngineRuntime({
      userDataPath: temporaryDirectory(),
      adapters: [adapter],
    })
    const activation = runtime.activate(MEDIA_PROJECT, MEDIA_SELECTION)
    await started
    await runtime.stop()
    releaseStart()
    await expect(activation).resolves.toMatchObject({ active: false, mode: 'none' })
    expect(stopCount).toBe(1)
  })

  it('publishes an inactive status before asynchronous native teardown completes', async () => {
    let releaseStop: () => void = () => undefined
    const stopBarrier = new Promise<void>((resolve) => {
      releaseStop = resolve
    })
    const adapter: WallpaperEngineRuntimeAdapter = {
      mode: 'media',
      canHandle: async () => true,
      start: async () => undefined,
      stop: async () => stopBarrier,
    }
    const runtime = new WallpaperEngineRuntime({
      userDataPath: temporaryDirectory(),
      adapters: [adapter],
    })
    await runtime.activate(MEDIA_PROJECT, MEDIA_SELECTION)

    const stopping = runtime.stop()
    expect(runtime.getStatus()).toMatchObject({ active: false, mode: 'none' })
    releaseStop()
    await stopping
  })

  it('fails closed instead of replacing a native Scene with a static preview', async () => {
    let nativeStopped = 0
    const nativeAdapter: WallpaperEngineRuntimeAdapter = {
      mode: 'dwm',
      canHandle: async () => true,
      start: async () => {
        throw new Error('WALLPAPER_ENGINE_DWM_HELPER_INVALID')
      },
      stop: async () => {
        nativeStopped += 1
      },
    }
    const runtime = new WallpaperEngineRuntime({
      userDataPath: temporaryDirectory(),
      adapters: [nativeAdapter],
    })
    await expect(
      runtime.activate(MEDIA_PROJECT, { ...MEDIA_SELECTION, kind: 'engine', projectType: 'scene' }),
    ).resolves.toMatchObject({
      active: false,
      mode: 'none',
      phase: 'failed',
      error: 'WALLPAPER_ENGINE_DWM_HELPER_INVALID',
    })
    expect(nativeStopped).toBe(0)
    await runtime.dispose()
  })

  it('persists selection, favorite and hidden state in the main process store', () => {
    const root = temporaryDirectory()
    const store = new WallpaperEngineStore(root)
    const id = '0123456789abcdef01234567'
    store.setFavorite(id, true)
    store.setProjectVisibility(id, true)
    store.setSelection({ active: true, id, title: 'Test' })
    const reopened = new WallpaperEngineStore(root).get()
    expect(reopened.favorites).toEqual([id])
    expect(reopened.hidden).toEqual([id])
    expect(reopened.selection).toMatchObject({ active: true, id, title: 'Test' })
  })
})

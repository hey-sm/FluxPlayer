import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  WallpaperEngineProject,
  WallpaperEngineRuntimeStatus,
  WallpaperEngineSelection,
} from '@shared/wallpaper-engine-contract'
import { discoverSteamLibraries } from './wallpaper-engine-library'
import { prepareSilentSceneProject } from './wallpaper-engine-scene-cache'

const execFileAsync = promisify(execFile)
const HELPER_NAME = 'FluxPlayer.WallpaperEngine.Helper.exe'
const DEFAULT_ALLOWED_PUBLISHERS = ['skutta software'] as const
const DEFAULT_ALLOWED_CERTIFICATE_FINGERPRINTS = ['dd012a83ad271d151a2ed8c7a1e97e62f4125a49'] as const
const MUTE_REASSERT_DELAYS_MS = [0, 120, 320, 700, 1300, 2200, 6500] as const

export interface WallpaperEngineCaptureSource {
  id: string
  name: string
}

export interface WallpaperEngineNativeSceneTarget {
  id: string
  projectFile: string
  scenePackage: string
  muteProperties: Record<string, number>
  presetProperties?: Record<string, boolean | number | string>
}

export interface WallpaperEngineHostDescriptor {
  windowHandle: string
  executable: string
  bounds: { x: number; y: number; width: number; height: number }
}

export interface WallpaperEngineRuntimeAdapter {
  readonly mode: Exclude<WallpaperEngineRuntimeStatus['mode'], 'none'>
  canHandle(project: WallpaperEngineProject, selection: WallpaperEngineSelection): Promise<boolean>
  start(
    project: WallpaperEngineProject,
    selection: WallpaperEngineSelection,
    sessionId: string,
  ): Promise<void>
  stop(): Promise<void>
  cancelPending?(): Promise<void>
  suspend?(): Promise<void>
  resume?(): Promise<void>
  refreshBounds?(): Promise<void>
  takeGlassSamplerSource?(sessionId: string): Promise<WallpaperEngineCaptureSource | null>
  activateSurface?(sessionId: string): Promise<void>
}

export interface WallpaperEngineRuntimeOptions {
  userDataPath: string
  discoverLibraries?: () => Promise<string[]>
  allowedPublishers?: readonly string[]
  allowedCertificateFingerprints?: readonly string[]
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  resolveNativeSceneTarget?: (id: string) => Promise<WallpaperEngineNativeSceneTarget>
  captureSources?: () => Promise<ReadonlyArray<WallpaperEngineCaptureSource>>
  runControl?: (executable: string, args: string[]) => Promise<void>
  verifyExecutable?: (executable: string) => Promise<boolean>
  resolveHost?: () => WallpaperEngineHostDescriptor | null
  helperPath?: string
  helperSpawn?: (executable: string) => ChildProcessWithoutNullStreams
  onNativeWindowReady?: () => void
  onNativeWindowStopped?: () => void
  onStatusChanged?: (status: WallpaperEngineRuntimeStatus) => void
  adapters?: readonly WallpaperEngineRuntimeAdapter[]
}

function runtimeError(code: string): Error {
  return new Error(code)
}

function safeRuntimeError(error: unknown, fallback = 'WALLPAPER_ENGINE_RUNTIME_UNAVAILABLE'): string {
  const message = error instanceof Error ? error.message : String(error)
  return /^WALLPAPER_ENGINE_[A-Z0-9_:-]{1,120}$/.test(message) ? message : fallback
}

function cleanList(value: string | readonly string[] | undefined): string[] {
  const input = Array.isArray(value) ? value.join(';') : String(value ?? '')
  return input
    .split(/[;,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

async function findOfficialExecutable(
  discoverLibraries: () => Promise<string[]>,
  arch: NodeJS.Architecture = process.arch,
): Promise<string> {
  const names =
    arch === 'ia32' ? ['wallpaper32.exe', 'wallpaper64.exe'] : ['wallpaper64.exe', 'wallpaper32.exe']
  for (const root of await discoverLibraries()) {
    for (const name of names) {
      for (const candidate of [
        path.join(root, 'steamapps', 'common', 'wallpaper_engine', name),
        path.join(root, 'steamapps', 'common', 'wallpaper_engine', 'bin', name),
      ]) {
        try {
          const real = await fs.realpath(candidate)
          if ((await fs.stat(real)).isFile() && path.basename(real).toLowerCase() === name) return real
        } catch {
          // Steam libraries may be disconnected while scanning.
        }
      }
    }
  }
  return ''
}

async function verifyAuthenticode(
  executable: string,
  allowedPublishers: readonly string[],
  allowedFingerprints: readonly string[],
  platform = process.platform,
): Promise<boolean> {
  if (platform !== 'win32' || (!allowedPublishers.length && !allowedFingerprints.length)) return false
  const escaped = executable.replace(/'/g, "''")
  const command = `$s=Get-AuthenticodeSignature -LiteralPath '${escaped}'; [pscustomobject]@{Status=$s.Status;Subject=$s.SignerCertificate.Subject;Thumbprint=$s.SignerCertificate.Thumbprint} | ConvertTo-Json -Compress`
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000,
        maxBuffer: 32 * 1024,
        env: {
          ...process.env,
          PSModulePath: path.join(
            process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'Modules',
          ),
        },
      },
    )
    const result = JSON.parse(String(stdout || '{}')) as {
      Status?: string
      Subject?: string
      Thumbprint?: string
    }
    const status = String(result.Status).trim().toLowerCase()
    if (status !== 'valid' && status !== '0') return false
    const subject = String(result.Subject || '').toLowerCase()
    const commonNames = [...subject.matchAll(/(?:^|,)\s*cn=([^,]+)/g)].map((match) => match[1].trim())
    const fingerprint = String(result.Thumbprint || '')
      .replace(/\s+/g, '')
      .toLowerCase()
    return (
      allowedPublishers.some((publisher) => commonNames.includes(publisher)) ||
      allowedFingerprints.some((item) => fingerprint === item.replace(/\s+/g, ''))
    )
  } catch {
    return false
  }
}

function quoteWindowsArgument(value: string): string {
  if (value && !/[\s"]/.test(value)) return value
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`
}

function rawPropertiesIndex(args: readonly string[]): number {
  const optionIndex = args.findIndex((value) => value.toLowerCase() === '-properties')
  const rawIndex = optionIndex + 1
  if (optionIndex < 0 || rawIndex >= args.length) return -1
  const raw = args[rawIndex]
  if (
    !raw.startsWith('RAW~(') ||
    !raw.endsWith(')~END') ||
    raw.includes('\u0000') ||
    raw.includes('\r') ||
    raw.includes('\n')
  )
    return -1
  try {
    const parsed = JSON.parse(raw.slice(5, -5)) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? rawIndex : -1
  } catch {
    return -1
  }
}

async function defaultRunControl(executable: string, args: string[]): Promise<void> {
  const rawIndex = rawPropertiesIndex(args)
  const prepared =
    rawIndex < 0
      ? args
      : args.map((value, index) => (index === rawIndex ? value : quoteWindowsArgument(value)))
  const verbatim = rawIndex >= 0
  const executablePath = verbatim ? path.basename(executable) : executable
  const command = args[0]?.toLowerCase() === '-control' ? args[1]?.toLowerCase() : ''
  if (command === 'openwallpaper') {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executablePath, prepared, {
        cwd: verbatim ? path.dirname(executable) : undefined,
        windowsHide: true,
        windowsVerbatimArguments: verbatim,
        stdio: 'ignore',
      })
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })
    return
  }
  await execFileAsync(executablePath, prepared, {
    cwd: verbatim ? path.dirname(executable) : undefined,
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  })
}

async function defaultCaptureSources(): Promise<ReadonlyArray<WallpaperEngineCaptureSource>> {
  const { desktopCapturer } = await import('electron')
  return desktopCapturer
    .getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
    .then((sources) => sources.map((source) => ({ id: source.id, name: source.name })))
}

async function findCaptureSource(
  captureSources: () => Promise<ReadonlyArray<WallpaperEngineCaptureSource>>,
  title: string,
  timeoutMs: number,
): Promise<WallpaperEngineCaptureSource> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const source = (await captureSources().catch(() => [])).find(
      (candidate) => candidate.name === title && /^window:\d+:\d+$/.test(candidate.id),
    )
    if (source) return source
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw runtimeError('WALLPAPER_ENGINE_WINDOW_TIMEOUT')
}

function sourceWindowHandle(sourceId: string): string {
  const match = /^window:(\d+):\d+$/.exec(sourceId)
  if (!match || match[1] === '0') throw runtimeError('WALLPAPER_ENGINE_WINDOW_ID_INVALID')
  return match[1]
}

function encodeField(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

async function resolveAndVerifyHelper(explicitPath = ''): Promise<string> {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    explicitPath,
    resourcesPath ? path.join(resourcesPath, 'native', 'win-x64', HELPER_NAME) : '',
    path.resolve(process.cwd(), 'resources', 'native', 'win-x64', HELPER_NAME),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      const [binary, expected] = await Promise.all([
        fs.readFile(candidate),
        fs.readFile(`${candidate}.sha256`, 'ascii'),
      ])
      const actual = crypto.createHash('sha256').update(binary).digest('hex')
      if (/^[a-f0-9]{64}$/i.test(expected.trim()) && actual === expected.trim().toLowerCase())
        return candidate
    } catch {
      // Try the next packaged/development location.
    }
  }
  throw runtimeError('WALLPAPER_ENGINE_DWM_HELPER_INVALID')
}

export class MediaRuntimeAdapter implements WallpaperEngineRuntimeAdapter {
  readonly mode = 'media' as const

  async canHandle(project: WallpaperEngineProject, selection: WallpaperEngineSelection): Promise<boolean> {
    return selection.kind === 'media' && project.playable && Boolean(project.mediaUrl)
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

interface DwmSession {
  sessionId: string
  projectId: string
  executable: string
  location: string
  source: WallpaperEngineCaptureSource
  helper: ChildProcessWithoutNullStreams
  surfaceTitle: string
  surfaceWindowHandle: string
  surfaceActive: boolean
  activationPromise: Promise<void> | null
  samplerConsumed: boolean
  muteTimers: NodeJS.Timeout[]
}

export class DwmRuntimeAdapter implements WallpaperEngineRuntimeAdapter {
  readonly mode = 'dwm' as const
  private readonly userDataPath: string
  private readonly discoverLibraries: () => Promise<string[]>
  private readonly allowedPublishers: readonly string[]
  private readonly allowedFingerprints: readonly string[]
  private readonly platform: NodeJS.Platform
  private readonly arch: NodeJS.Architecture
  private readonly resolveNativeSceneTarget?: (id: string) => Promise<WallpaperEngineNativeSceneTarget>
  private readonly captureSources: () => Promise<ReadonlyArray<WallpaperEngineCaptureSource>>
  private readonly runControl: (executable: string, args: string[]) => Promise<void>
  private readonly verifyExecutable?: (executable: string) => Promise<boolean>
  private readonly resolveHost?: () => WallpaperEngineHostDescriptor | null
  private readonly helperPath: string
  private readonly helperSpawn: (executable: string) => ChildProcessWithoutNullStreams
  private readonly onNativeWindowReady?: () => void
  private readonly onNativeWindowStopped?: () => void
  private readonly onFailure: (sessionId: string, error: string) => void
  private verifiedExecutable = ''
  private active: DwmSession | null = null
  private pending: {
    executable: string
    location: string
    helper: ChildProcessWithoutNullStreams | null
  } | null = null

  constructor(
    options: WallpaperEngineRuntimeOptions & { onFailure?: (sessionId: string, error: string) => void },
  ) {
    this.userDataPath = path.resolve(options.userDataPath)
    this.discoverLibraries = options.discoverLibraries ?? discoverSteamLibraries
    this.allowedPublishers = cleanList(
      options.allowedPublishers ?? process.env.FLUXPLAYER_WE_ALLOWED_PUBLISHERS ?? DEFAULT_ALLOWED_PUBLISHERS,
    )
    this.allowedFingerprints = cleanList(
      options.allowedCertificateFingerprints ??
        process.env.FLUXPLAYER_WE_ALLOWED_CERT_FINGERPRINTS ??
        DEFAULT_ALLOWED_CERTIFICATE_FINGERPRINTS,
    )
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.resolveNativeSceneTarget = options.resolveNativeSceneTarget
    this.captureSources = options.captureSources ?? defaultCaptureSources
    this.runControl = options.runControl ?? defaultRunControl
    this.verifyExecutable = options.verifyExecutable
    this.resolveHost = options.resolveHost
    this.helperPath = options.helperPath ?? ''
    this.helperSpawn =
      options.helperSpawn ??
      ((executable) =>
        spawn(executable, [], {
          detached: true,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        }) as ChildProcessWithoutNullStreams)
    this.onNativeWindowReady = options.onNativeWindowReady
    this.onNativeWindowStopped = options.onNativeWindowStopped
    this.onFailure = options.onFailure ?? (() => undefined)
  }

  private async findVerifiedExecutable(): Promise<string> {
    if (this.verifiedExecutable) return this.verifiedExecutable
    const executable = await findOfficialExecutable(this.discoverLibraries, this.arch)
    if (!executable) return ''
    const verified = await (this.verifyExecutable
      ? this.verifyExecutable(executable)
      : verifyAuthenticode(executable, this.allowedPublishers, this.allowedFingerprints, this.platform))
    if (verified) this.verifiedExecutable = executable
    return verified ? executable : ''
  }

  async canHandle(project: WallpaperEngineProject, selection: WallpaperEngineSelection): Promise<boolean> {
    if (
      this.platform !== 'win32' ||
      this.arch !== 'x64' ||
      project.projectType !== 'scene' ||
      !project.enginePlayable ||
      selection.kind !== 'engine' ||
      !this.resolveNativeSceneTarget ||
      !this.resolveHost
    )
      return false
    return Boolean(await this.findVerifiedExecutable())
  }

  async start(
    project: WallpaperEngineProject,
    _selection: WallpaperEngineSelection,
    sessionId: string,
  ): Promise<void> {
    if (!this.resolveNativeSceneTarget || !this.resolveHost) {
      throw runtimeError('WALLPAPER_ENGINE_DWM_UNAVAILABLE')
    }
    const host = this.resolveHost()
    if (!host || !/^\d+$/.test(host.windowHandle) || !path.isAbsolute(host.executable)) {
      throw runtimeError('WALLPAPER_ENGINE_HOST_INVALID')
    }
    const [target, executable, helperExecutable] = await Promise.all([
      this.resolveNativeSceneTarget(project.id),
      this.findVerifiedExecutable(),
      resolveAndVerifyHelper(this.helperPath),
    ])
    if (!executable) throw runtimeError('WALLPAPER_ENGINE_NOT_INSTALLED')
    if (!target || target.id.toLowerCase() !== project.id.toLowerCase()) {
      throw runtimeError('WALLPAPER_ENGINE_SCENE_TARGET_INVALID')
    }
    const cache = await prepareSilentSceneProject({
      cacheRoot: path.join(this.userDataPath, 'wallpaper-engine-runtime', 'silent-scenes'),
      projectFile: target.projectFile,
      scenePackage: target.scenePackage,
    })
    const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
    const location = `FluxPlayer Wallpaper ${safeSession}`
    const width = Math.max(320, Math.min(7680, Math.round(host.bounds.width)))
    const height = Math.max(180, Math.min(4320, Math.round(host.bounds.height)))
    const pending = { executable, location, helper: null as ChildProcessWithoutNullStreams | null }
    this.pending = pending
    let opened = false
    try {
      await this.runControl(executable, [
        '-control',
        'openWallpaper',
        '-file',
        cache.projectFile,
        '-playInWindow',
        location,
        '-width',
        String(width),
        '-height',
        String(height),
        '-x',
        String(Math.round(host.bounds.x)),
        '-y',
        String(Math.round(host.bounds.y)),
        '-borderless',
      ])
      opened = true
      const source = await findCaptureSource(this.captureSources, location, 15_000)
      if (this.pending !== pending) throw runtimeError('WALLPAPER_ENGINE_START_SUPERSEDED')
      await this.applyProperties(executable, location, target)
      const helper = this.helperSpawn(helperExecutable)
      pending.helper = helper
      const ready = await this.startHelper(helper, {
        sessionId,
        source,
        sourceTitle: location,
        sourceExecutable: executable,
        host,
      })
      if (this.pending !== pending) throw runtimeError('WALLPAPER_ENGINE_START_SUPERSEDED')
      const session: DwmSession = {
        sessionId,
        projectId: project.id,
        executable,
        location,
        source,
        helper,
        surfaceTitle: ready.surfaceTitle,
        surfaceWindowHandle: ready.surfaceWindowHandle,
        surfaceActive: false,
        activationPromise: null,
        samplerConsumed: false,
        muteTimers: [],
      }
      helper.once('exit', () => {
        if (this.active !== session) return
        this.onFailure(sessionId, 'WALLPAPER_ENGINE_DWM_HELPER_EXITED')
      })
      this.active = session
      this.pending = null
      this.scheduleMuteReassertion(session, target)
      this.onNativeWindowReady?.()
    } catch (error) {
      if (this.pending === pending) this.pending = null
      await this.stopHelper(pending.helper)
      if (opened) await this.closeWallpaper(executable, location)
      throw error
    }
  }

  private async startHelper(
    helper: ChildProcessWithoutNullStreams,
    input: {
      sessionId: string
      source: WallpaperEngineCaptureSource
      sourceTitle: string
      sourceExecutable: string
      host: WallpaperEngineHostDescriptor
    },
  ): Promise<{ surfaceTitle: string; surfaceWindowHandle: string }> {
    const command = [
      'START',
      encodeField(input.sessionId),
      sourceWindowHandle(input.source.id),
      encodeField(input.sourceTitle),
      encodeField(input.sourceExecutable),
      input.host.windowHandle,
      encodeField(input.host.executable),
      String(process.pid),
    ].join('\t')
    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (error?: Error, value?: { surfaceTitle: string; surfaceWindowHandle: string }) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        helper.stdout.removeListener('data', onStdout)
        helper.stderr.removeListener('data', onStderr)
        helper.removeListener('error', onError)
        helper.removeListener('exit', onExit)
        if (error) reject(error)
        else resolve(value ?? { surfaceTitle: '', surfaceWindowHandle: '' })
      }
      const onStdout = (chunk: Buffer | string) => {
        stdout = `${stdout}${String(chunk)}`.slice(-16_384)
        for (const line of stdout.split(/\r?\n/)) {
          if (!line.trim().startsWith('{')) continue
          try {
            const result = JSON.parse(line) as {
              ready?: boolean
              surfaceTitle?: string
              surfaceWindowHandle?: number | string
            }
            const surfaceWindowHandle = String(result.surfaceWindowHandle ?? '')
            if (result.ready && result.surfaceTitle && /^\d+$/.test(surfaceWindowHandle)) {
              finish(undefined, { surfaceTitle: result.surfaceTitle, surfaceWindowHandle })
              return
            }
          } catch {
            // Wait for a complete JSON line.
          }
        }
      }
      const onStderr = (chunk: Buffer | string) => {
        stderr = `${stderr}${String(chunk)}`.slice(-4096)
      }
      const onError = () => finish(runtimeError('WALLPAPER_ENGINE_DWM_HELPER_START_FAILED'))
      const onExit = () =>
        finish(runtimeError(safeRuntimeError(stderr.trim(), 'WALLPAPER_ENGINE_DWM_HELPER_START_FAILED')))
      const timeout = setTimeout(() => finish(runtimeError('WALLPAPER_ENGINE_DWM_HELPER_TIMEOUT')), 7000)
      helper.stdout.on('data', onStdout)
      helper.stderr.on('data', onStderr)
      helper.once('error', onError)
      helper.once('exit', onExit)
      helper.stdin.write(`${command}\n`)
    })
  }

  async activateSurface(sessionId: string): Promise<void> {
    const session = this.active
    if (!session || session.sessionId !== sessionId) {
      throw runtimeError('WALLPAPER_ENGINE_SESSION_MISMATCH')
    }
    if (session.surfaceActive) return
    if (session.activationPromise) return session.activationPromise
    const operation = new Promise<void>((resolve, reject) => {
      const helper = session.helper
      let stdout = ''
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        helper.stdout.removeListener('data', onStdout)
        helper.removeListener('error', onError)
        helper.removeListener('exit', onExit)
        if (error) reject(error)
        else resolve()
      }
      const onStdout = (chunk: Buffer | string) => {
        stdout = `${stdout}${String(chunk)}`.slice(-8192)
        const lines = stdout.split(/\r?\n/)
        stdout = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim().startsWith('{')) continue
          try {
            const result = JSON.parse(line) as {
              ok?: boolean
              active?: boolean
              surfaceWindowHandle?: number | string
              error?: string
            }
            if (result.ok === false) {
              finish(runtimeError(safeRuntimeError(result.error, 'WALLPAPER_ENGINE_DWM_ACTIVATE_FAILED')))
              return
            }
            if (
              result.ok === true &&
              result.active === true &&
              String(result.surfaceWindowHandle ?? '') === session.surfaceWindowHandle
            ) {
              session.surfaceActive = true
              finish()
              return
            }
          } catch {
            // Wait for the next complete helper response.
          }
        }
      }
      const onError = () => finish(runtimeError('WALLPAPER_ENGINE_DWM_HELPER_START_FAILED'))
      const onExit = () => finish(runtimeError('WALLPAPER_ENGINE_DWM_HELPER_EXITED'))
      const timeout = setTimeout(() => finish(runtimeError('WALLPAPER_ENGINE_DWM_ACTIVATE_TIMEOUT')), 2500)
      helper.stdout.on('data', onStdout)
      helper.once('error', onError)
      helper.once('exit', onExit)
      if (!helper.stdin.writable) {
        finish(runtimeError('WALLPAPER_ENGINE_DWM_HELPER_EXITED'))
        return
      }
      helper.stdin.write('D\n')
    })
    session.activationPromise = operation
    try {
      await operation
    } finally {
      if (session.activationPromise === operation) session.activationPromise = null
    }
  }

  private async applyProperties(
    executable: string,
    location: string,
    target: WallpaperEngineNativeSceneTarget,
  ): Promise<void> {
    await this.runControl(executable, [
      '-control',
      'applyProperties',
      '-properties',
      `RAW~(${JSON.stringify({ ...(target.presetProperties ?? {}), ...target.muteProperties })})~END`,
      '-location',
      location,
    ])
  }

  private scheduleMuteReassertion(session: DwmSession, target: WallpaperEngineNativeSceneTarget): void {
    for (const delay of MUTE_REASSERT_DELAYS_MS) {
      const timer = setTimeout(() => {
        if (this.active !== session) return
        void this.applyProperties(session.executable, session.location, target).catch(() => undefined)
      }, delay)
      timer.unref()
      session.muteTimers.push(timer)
    }
  }

  async takeGlassSamplerSource(sessionId: string): Promise<WallpaperEngineCaptureSource | null> {
    const session = this.active
    if (!session || session.sessionId !== sessionId || session.samplerConsumed || !session.surfaceTitle)
      return null
    const source = await findCaptureSource(this.captureSources, session.surfaceTitle, 2500).catch(() => null)
    if (!source || this.active !== session) return null
    session.samplerConsumed = true
    return source
  }

  async suspend(): Promise<void> {
    if (this.active?.helper.stdin.writable) this.active.helper.stdin.write('S\n')
  }

  async resume(): Promise<void> {
    if (this.active?.helper.stdin.writable) this.active.helper.stdin.write('R\n')
  }

  async refreshBounds(): Promise<void> {
    await this.resume()
  }

  private async closeWallpaper(executable: string, location: string): Promise<void> {
    await this.runControl(executable, ['-control', 'closeWallpaper', '-location', location]).catch(
      () => undefined,
    )
  }

  private async stopHelper(helper: ChildProcessWithoutNullStreams | null): Promise<void> {
    if (!helper || helper.exitCode !== null) return
    if (helper.stdin.writable) helper.stdin.write('Q\n')
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        helper.kill()
        resolve()
      }, 800)
      helper.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    const session = this.active
    const pending = this.pending
    this.active = null
    this.pending = null
    session?.muteTimers.forEach(clearTimeout)
    await this.stopHelper(session?.helper ?? pending?.helper ?? null)
    if (session) await this.closeWallpaper(session.executable, session.location)
    if (pending && (!session || pending.location !== session.location)) {
      await this.closeWallpaper(pending.executable, pending.location)
    }
    this.onNativeWindowStopped?.()
  }

  async cancelPending(): Promise<void> {
    const pending = this.pending
    this.pending = null
    if (!pending) return
    await this.stopHelper(pending.helper)
    await this.closeWallpaper(pending.executable, pending.location)
  }
}

function idleStatus(): WallpaperEngineRuntimeStatus {
  return {
    ok: true,
    active: false,
    mode: 'none',
    phase: 'idle',
    sessionId: '',
    projectId: '',
    glassSamplerAvailable: false,
    error: '',
  }
}

export class WallpaperEngineRuntime {
  private readonly adapters: WallpaperEngineRuntimeAdapter[]
  private readonly onStatusChanged?: (status: WallpaperEngineRuntimeStatus) => void
  private generation = 0
  private activeAdapter: WallpaperEngineRuntimeAdapter | null = null
  private startingAdapter: WallpaperEngineRuntimeAdapter | null = null
  private preparedGlassSource: { source: WallpaperEngineCaptureSource; expiresAt: number } | null = null
  private status = idleStatus()

  constructor(options: WallpaperEngineRuntimeOptions) {
    this.onStatusChanged = options.onStatusChanged
    this.adapters = options.adapters
      ? [...options.adapters]
      : [
          new MediaRuntimeAdapter(),
          new DwmRuntimeAdapter({
            ...options,
            onFailure: (sessionId, error) => void this.failSession(sessionId, error),
          }),
        ]
  }

  private setStatus(status: WallpaperEngineRuntimeStatus): void {
    this.status = status
    this.onStatusChanged?.({ ...status })
  }

  getStatus(): WallpaperEngineRuntimeStatus {
    return { ...this.status }
  }

  async activate(
    project: WallpaperEngineProject,
    selection: WallpaperEngineSelection,
  ): Promise<WallpaperEngineRuntimeStatus> {
    await this.stop()
    const generation = ++this.generation
    const sessionId = crypto.randomUUID()
    this.setStatus({
      ok: true,
      active: false,
      mode: selection.kind === 'engine' ? 'dwm' : 'media',
      phase: 'starting',
      sessionId,
      projectId: project.id,
      glassSamplerAvailable: false,
      error: '',
    })
    let lastError = 'WALLPAPER_ENGINE_PROJECT_UNSUPPORTED'
    for (const adapter of this.adapters) {
      if (generation !== this.generation) return this.getStatus()
      try {
        if (!(await adapter.canHandle(project, selection))) continue
        this.startingAdapter = adapter
        try {
          await adapter.start(project, selection, sessionId)
        } finally {
          if (this.startingAdapter === adapter) this.startingAdapter = null
        }
        if (generation !== this.generation) {
          await adapter.stop()
          return this.getStatus()
        }
        this.activeAdapter = adapter
        const awaitingDwmActivation = adapter.mode === 'dwm' && Boolean(adapter.activateSurface)
        this.setStatus({
          ok: true,
          active: !awaitingDwmActivation,
          mode: adapter.mode,
          phase: awaitingDwmActivation ? 'starting' : 'active',
          sessionId,
          projectId: project.id,
          glassSamplerAvailable: awaitingDwmActivation,
          error: '',
        })
        return this.getStatus()
      } catch (error) {
        lastError = safeRuntimeError(error)
        if (lastError === 'WALLPAPER_ENGINE_RUNTIME_UNAVAILABLE') {
          console.error(`[Wallpaper Engine] ${adapter.mode} activation failed`, error)
        }
      }
    }
    this.setStatus({
      ok: false,
      active: false,
      mode: 'none',
      phase: 'failed',
      sessionId: '',
      projectId: project.id,
      glassSamplerAvailable: false,
      error: lastError,
    })
    return this.getStatus()
  }

  async stop(): Promise<void> {
    this.generation += 1
    const active = this.activeAdapter
    const starting = this.startingAdapter
    this.activeAdapter = null
    this.startingAdapter = null
    this.preparedGlassSource = null
    this.setStatus(idleStatus())
    if (active) await active.stop().catch(() => undefined)
    if (starting && starting !== active) await starting.cancelPending?.().catch(() => undefined)
  }

  async suspend(): Promise<void> {
    if (!this.activeAdapter || !this.status.active || this.status.phase === 'suspended') return
    await this.activeAdapter.suspend?.().catch(() => undefined)
    this.setStatus({ ...this.status, phase: 'suspended' })
  }

  async resume(): Promise<void> {
    if (!this.activeAdapter || !this.status.active || this.status.phase === 'active') return
    this.setStatus({ ...this.status, phase: 'recovering' })
    try {
      await this.activeAdapter.resume?.()
      this.setStatus({ ...this.status, phase: 'active' })
    } catch (error) {
      await this.failSession(this.status.sessionId, safeRuntimeError(error))
    }
  }

  async refreshBounds(): Promise<void> {
    if (!this.activeAdapter || !this.status.active) return
    await this.activeAdapter.refreshBounds?.().catch(() => undefined)
  }

  async takeGlassSamplerSource(sessionId: string): Promise<WallpaperEngineCaptureSource | null> {
    if (
      !this.activeAdapter ||
      this.status.mode !== 'dwm' ||
      (this.status.phase !== 'starting' && this.status.phase !== 'active') ||
      this.status.sessionId !== sessionId
    )
      return null
    return this.activeAdapter.takeGlassSamplerSource?.(sessionId) ?? null
  }

  async activateDwmSurface(sessionId: string): Promise<boolean> {
    const adapter = this.activeAdapter
    if (!adapter || this.status.mode !== 'dwm' || this.status.sessionId !== sessionId) return false
    if (this.status.active && this.status.phase === 'active') return true
    const activateSurface = adapter.activateSurface
    if (this.status.phase !== 'starting' || !activateSurface) return false
    try {
      await activateSurface.call(adapter, sessionId)
      if (
        this.activeAdapter !== adapter ||
        this.status.sessionId !== sessionId ||
        this.status.phase !== 'starting'
      )
        return false
      this.setStatus({ ...this.status, active: true, phase: 'active' })
      return true
    } catch (error) {
      await this.failSession(sessionId, safeRuntimeError(error, 'WALLPAPER_ENGINE_DWM_ACTIVATE_FAILED'))
      return false
    }
  }

  async prepareGlassSampler(sessionId: string): Promise<boolean> {
    this.preparedGlassSource = null
    const source = await this.takeGlassSamplerSource(sessionId)
    if (!source || this.status.sessionId !== sessionId) return false
    this.preparedGlassSource = { source, expiresAt: Date.now() + 3000 }
    return true
  }

  takePreparedGlassSamplerSource(): WallpaperEngineCaptureSource | null {
    const grant = this.preparedGlassSource
    this.preparedGlassSource = null
    return grant && grant.expiresAt >= Date.now() ? { ...grant.source } : null
  }

  private async failSession(sessionId: string, error: string): Promise<void> {
    if (!sessionId || this.status.sessionId !== sessionId) return
    const projectId = this.status.projectId
    const adapter = this.activeAdapter
    this.activeAdapter = null
    this.preparedGlassSource = null
    this.generation += 1
    this.setStatus({
      ok: false,
      active: false,
      mode: 'none',
      phase: 'failed',
      sessionId: '',
      projectId,
      glassSamplerAvailable: false,
      error: safeRuntimeError(error),
    })
    await adapter?.stop().catch(() => undefined)
  }

  async dispose(): Promise<void> {
    await this.stop()
  }
}

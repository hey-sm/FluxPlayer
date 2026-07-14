import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
  type Request,
  type Route,
} from '@playwright/test'

export const E2E_WAV_FIXTURE_URL = 'https://e2e.music.126.net/playwright-memory.wav'

export interface ElectronExit {
  code: number | null
  signal: NodeJS.Signals | null
}

export interface ElectronHarness {
  app: ElectronApplication
  page: Page
  rendererCrashes: string[]
  sandboxPath: string
  waitForExit(timeoutMs?: number): Promise<ElectronExit>
  close(): Promise<ElectronExit>
}

type ElectronFixtures = { electronHarness: ElectronHarness }

type ProcessIdentity = {
  pid: number
  parentPid: number
  creationDate: string
  name: string
}

type ShutdownOutcome = {
  exit: ElectronExit
  errors: Error[]
  forced: boolean
}

const PROCESS_SAMPLE_INTERVAL_MS = 400
const PROCESS_EXIT_TIMEOUT_MS = 5_000

function environmentWithIsolatedPaths(sandboxPath: string): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )

  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.FLUX_SMOKE

  const home = path.join(sandboxPath, 'home')
  env.APPDATA = path.join(sandboxPath, 'appdata', 'roaming')
  env.LOCALAPPDATA = path.join(sandboxPath, 'appdata', 'local')
  env.HOME = home
  env.TEMP = path.join(sandboxPath, 'temp')
  env.TMP = env.TEMP
  env.XDG_CONFIG_HOME = path.join(sandboxPath, 'xdg', 'config')
  env.XDG_CACHE_HOME = path.join(sandboxPath, 'xdg', 'cache')

  if (process.platform === 'win32') {
    const parsedHome = path.parse(home)
    env.USERPROFILE = home
    env.HOMEDRIVE = parsedHome.root.replace(/[\\/]$/, '')
    env.HOMEPATH = home.slice(parsedHome.root.length - 1)
  }

  env.FLUX_E2E = '1'
  env.NODE_ENV = 'test'
  return env
}

function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root)
  const normalizedCandidate = path.resolve(candidate)
  const relative = path.relative(normalizedRoot, normalizedCandidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function createPcmWav(durationSeconds = 8, sampleRate = 16_000): Buffer {
  const channels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const sampleCount = durationSeconds * sampleRate
  const dataLength = sampleCount * channels * bytesPerSample
  const wav = Buffer.alloc(44 + dataLength)

  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + dataLength, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(channels, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  wav.writeUInt16LE(channels * bytesPerSample, 32)
  wav.writeUInt16LE(bitsPerSample, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(dataLength, 40)

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const envelope = Math.min(1, sample / (sampleRate * 0.02))
    const value = Math.sin((sample * Math.PI * 2 * 440) / sampleRate) * 0.18 * envelope
    wav.writeInt16LE(Math.round(value * 0x7fff), 44 + sample * bytesPerSample)
  }
  return wav
}

const E2E_WAV = createPcmWav()

function requestedRange(route: Route, totalBytes: number): { start: number; end: number } | null {
  const header = route.request().headers().range
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match) return null

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, totalBytes - suffixLength), end: totalBytes - 1 }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : totalBytes - 1
  if (!Number.isFinite(start) || !Number.isFinite(requestedEnd) || start >= totalBytes) return null
  return { start, end: Math.min(totalBytes - 1, Math.max(start, requestedEnd)) }
}

export async function fulfillE2EWav(route: Route): Promise<void> {
  const rangeHeader = route.request().headers().range
  const range = requestedRange(route, E2E_WAV.length)
  if (rangeHeader && !range) {
    await route.fulfill({
      status: 416,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Range': `bytes */${E2E_WAV.length}`,
      },
      body: Buffer.alloc(0),
    })
    return
  }

  if (range) {
    const body = E2E_WAV.subarray(range.start, range.end + 1)
    await route.fulfill({
      status: 206,
      headers: {
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': String(body.length),
        'Content-Range': `bytes ${range.start}-${range.end}/${E2E_WAV.length}`,
        'Content-Type': 'audio/wav',
      },
      body,
    })
    return
  }

  await route.fulfill({
    status: 200,
    headers: {
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': String(E2E_WAV.length),
      'Content-Type': 'audio/wav',
    },
    body: E2E_WAV,
  })
}

function isAllowedLocalRequest(request: Request): boolean {
  const requestUrl = new URL(request.url())
  if (['file:', 'data:', 'blob:', 'devtools:', 'chrome-extension:'].includes(requestUrl.protocol)) return true
  if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') return false
  const hostname = requestUrl.hostname.toLowerCase()
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function targetsMemoryWav(request: Request): boolean {
  const requestUrl = new URL(request.url())
  if (requestUrl.toString() === E2E_WAV_FIXTURE_URL) return true
  return (
    requestUrl.pathname.endsWith('/api/audio') && requestUrl.searchParams.get('url') === E2E_WAV_FIXTURE_URL
  )
}

async function guardNetworkRequest(route: Route, violations: string[]): Promise<void> {
  const request = route.request()
  // The synthetic public-looking URL is never sent to the network. Direct requests and the local
  // renderer proxy form both receive the same in-memory PCM fixture.
  if (targetsMemoryWav(request)) {
    await fulfillE2EWav(route)
    return
  }
  if (isAllowedLocalRequest(request)) {
    await route.fallback()
    return
  }

  const message = `Blocked unmatched external ${request.method()} ${request.url()} (${request.resourceType()})`
  violations.push(message)
  await route.abort('blockedbyclient')
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs))
}

function execute(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

async function windowsProcessSnapshot(): Promise<ProcessIdentity[]> {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,Name)',
    '$rows | ConvertTo-Json -Compress',
  ].join('; ')
  const stdout = await execute('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ])
  const parsed = JSON.parse(stdout) as
    | Array<{ ProcessId: number; ParentProcessId: number; CreationDate?: string; Name?: string }>
    | { ProcessId: number; ParentProcessId: number; CreationDate?: string; Name?: string }
  return (Array.isArray(parsed) ? parsed : [parsed])
    .filter((entry) => Boolean(entry.CreationDate))
    .map((entry) => ({
      pid: entry.ProcessId,
      parentPid: entry.ParentProcessId,
      creationDate: entry.CreationDate ?? '',
      name: entry.Name ?? '[unknown]',
    }))
}

async function unixProcessSnapshot(): Promise<ProcessIdentity[]> {
  const stdout = await execute('ps', ['-axo', 'pid=,ppid=,lstart=,comm='])
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      creationDate: match[3],
      name: match[4],
    }))
}

function processSnapshot(): Promise<ProcessIdentity[]> {
  return process.platform === 'win32' ? windowsProcessSnapshot() : unixProcessSnapshot()
}

function sameProcess(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return left.pid === right.pid && left.creationDate === right.creationDate
}

function formatProcesses(processes: ProcessIdentity[]): string[] {
  return processes.map(
    (entry) => `${entry.name} (pid ${entry.pid}, parent ${entry.parentPid}, created ${entry.creationDate})`,
  )
}

function processDepth(processIdentity: ProcessIdentity, tracked: Map<number, ProcessIdentity>): number {
  let depth = 0
  let current = processIdentity
  const visited = new Set<number>()
  while (!visited.has(current.pid)) {
    visited.add(current.pid)
    const parent = tracked.get(current.parentPid)
    if (!parent) break
    depth += 1
    current = parent
  }
  return depth
}

async function terminateVerifiedProcesses(
  processes: ProcessIdentity[],
  tracked: Map<number, ProcessIdentity>,
): Promise<void> {
  const ordered = [...processes].sort(
    (left, right) => processDepth(right, tracked) - processDepth(left, tracked),
  )
  if (ordered.length === 0) return

  if (process.platform === 'win32') {
    const payload = Buffer.from(
      JSON.stringify(ordered.map(({ pid, creationDate }) => ({ pid, creationDate }))),
      'utf8',
    ).toString('base64')
    const script = [
      '$ErrorActionPreference = "Stop"',
      '$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[0]))',
      '$targets = @($json | ConvertFrom-Json)',
      'foreach ($target in $targets) {',
      '  $processId = [int]$target.pid',
      '  $current = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $processId)',
      '  if ($null -eq $current) { continue }',
      '  $expected = [DateTimeOffset]::Parse([string]$target.creationDate, [Globalization.CultureInfo]::InvariantCulture)',
      '  $actual = [DateTimeOffset]$current.CreationDate',
      '  if ($actual.UtcDateTime.Ticks -ne $expected.UtcDateTime.Ticks) { continue }',
      '  $result = Invoke-CimMethod -InputObject $current -MethodName Terminate -Arguments @{ Reason = 1 }',
      '  if ($result.ReturnValue -ne 0) { throw "Terminate failed for verified PID $processId with code $($result.ReturnValue)" }',
      '}',
    ].join('\n')
    await execute('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
      payload,
    ])
    return
  }

  const liveByPid = new Map((await processSnapshot()).map((entry) => [entry.pid, entry]))
  for (const identity of ordered) {
    const live = liveByPid.get(identity.pid)
    if (!live || !sameProcess(identity, live)) continue
    process.kill(identity.pid, 'SIGKILL')
  }
}

class VerifiedProcessTree {
  private readonly tracked = new Map<number, ProcessIdentity>()
  private sampleTail: Promise<void> = Promise.resolve()
  private samplingStopped = false
  private samplingLoop: Promise<void> | undefined
  private lastSamplingError: Error | undefined

  private constructor(private readonly rootPid: number) {}

  static async create(rootPid: number, timeoutMs = 5_000): Promise<VerifiedProcessTree> {
    const tracker = new VerifiedProcessTree(rootPid)
    const deadline = Date.now() + timeoutMs
    let lastError: Error | undefined

    while (Date.now() < deadline) {
      try {
        const snapshot = await processSnapshot()
        const root = snapshot.find((entry) => entry.pid === rootPid)
        if (root?.creationDate) {
          tracker.tracked.set(root.pid, root)
          tracker.absorbSnapshot(snapshot)
          tracker.startSampling()
          return tracker
        }
        lastError = new Error(`Electron root PID ${rootPid} was not present in the process snapshot`)
      } catch (error) {
        lastError = toError(error)
      }
      await delay(100)
    }

    throw new Error(`Could not verify Electron root PID ${rootPid} and its creation time`, {
      cause: lastError,
    })
  }

  private absorbSnapshot(snapshot: ProcessIdentity[]): void {
    const liveByPid = new Map(snapshot.map((entry) => [entry.pid, entry]))
    const verifiedTree = new Set<number>()

    for (const identity of this.tracked.values()) {
      const live = liveByPid.get(identity.pid)
      if (live && sameProcess(identity, live)) verifiedTree.add(identity.pid)
    }

    let changed = true
    while (changed) {
      changed = false
      for (const candidate of snapshot) {
        if (!verifiedTree.has(candidate.parentPid) || verifiedTree.has(candidate.pid)) continue
        const previous = this.tracked.get(candidate.pid)
        // A reused PID is never adopted into this invocation's tree.
        if (previous && !sameProcess(previous, candidate)) continue
        this.tracked.set(candidate.pid, candidate)
        verifiedTree.add(candidate.pid)
        changed = true
      }
    }
  }

  private startSampling(): void {
    this.samplingLoop = (async () => {
      while (!this.samplingStopped) {
        try {
          await this.sample()
          this.lastSamplingError = undefined
        } catch (error) {
          this.lastSamplingError = toError(error)
        }
        if (!this.samplingStopped) await delay(PROCESS_SAMPLE_INTERVAL_MS)
      }
    })()
  }

  sample(): Promise<void> {
    const next = this.sampleTail.then(async () => {
      const snapshot = await processSnapshot()
      this.absorbSnapshot(snapshot)
    })
    this.sampleTail = next.catch(() => undefined)
    return next
  }

  private async liveProcesses(): Promise<ProcessIdentity[]> {
    const snapshot = await processSnapshot()
    this.absorbSnapshot(snapshot)
    const liveByPid = new Map(snapshot.map((entry) => [entry.pid, entry]))
    return [...this.tracked.values()].filter((identity) => {
      const live = liveByPid.get(identity.pid)
      return Boolean(live && sameProcess(identity, live))
    })
  }

  async waitForExit(timeoutMs = PROCESS_EXIT_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let remaining: ProcessIdentity[] = []
    let snapshotError: Error | undefined

    while (Date.now() < deadline) {
      try {
        remaining = await this.liveProcesses()
        snapshotError = undefined
        if (remaining.length === 0) return
      } catch (error) {
        snapshotError = toError(error)
      }
      await delay(200)
    }

    if (snapshotError)
      throw new Error('Could not verify that the Electron process tree exited', { cause: snapshotError })
    throw new Error(`Electron process tree still running: ${formatProcesses(remaining).join(', ')}`, {
      cause: this.lastSamplingError,
    })
  }

  async forceTerminate(): Promise<void> {
    await this.stopSampling()
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const live = await this.liveProcesses()
      if (live.length === 0) return
      await terminateVerifiedProcesses(live, this.tracked)
      await delay(250)
    }
    await this.waitForExit(PROCESS_EXIT_TIMEOUT_MS)
  }

  async stopSampling(): Promise<void> {
    this.samplingStopped = true
    await this.samplingLoop
    await this.sampleTail
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function combineErrors(message: string, errors: Error[]): Error {
  return errors.length === 1 ? errors[0] : new AggregateError(errors, message)
}

class ElectronProcessController {
  private readonly child: ReturnType<ElectronApplication['process']>
  private readonly exitPromise: Promise<ElectronExit>
  private exitResult: ElectronExit | undefined
  private tracker: VerifiedProcessTree | undefined
  private shutdownPromise: Promise<ShutdownOutcome> | undefined

  constructor(private readonly app: ElectronApplication) {
    this.child = app.process()
    if (!this.child.pid) throw new Error('Electron launched without an observable root PID')

    this.exitResult =
      this.child.exitCode !== null || this.child.signalCode !== null
        ? { code: this.child.exitCode, signal: this.child.signalCode }
        : undefined
    this.exitPromise = this.exitResult
      ? Promise.resolve(this.exitResult)
      : new Promise<ElectronExit>((resolve) => {
          this.child.once('exit', (code, signal) => {
            this.exitResult = { code, signal }
            resolve(this.exitResult)
          })
        })
  }

  async initialize(): Promise<void> {
    this.tracker = await VerifiedProcessTree.create(this.child.pid as number)
  }

  private async ensureTracker(): Promise<VerifiedProcessTree> {
    this.tracker ??= await VerifiedProcessTree.create(this.child.pid as number)
    return this.tracker
  }

  async waitForExit(timeoutMs = 15_000): Promise<ElectronExit> {
    const tracker = await this.ensureTracker()
    await tracker.sample()
    const result = this.exitResult
      ? this.exitResult
      : await withTimeout(this.exitPromise, timeoutMs, `Electron did not exit within ${timeoutMs}ms`)
    await tracker.waitForExit(PROCESS_EXIT_TIMEOUT_MS)
    await tracker.stopSampling()
    return result
  }

  close(): Promise<ElectronExit> {
    return this.shutdown().then((outcome) => {
      if (outcome.errors.length > 0) throw combineErrors('Electron cleanup failed', outcome.errors)
      return outcome.exit
    })
  }

  shutdown(): Promise<ShutdownOutcome> {
    this.shutdownPromise ??= this.performShutdown()
    return this.shutdownPromise
  }

  private async performShutdown(): Promise<ShutdownOutcome> {
    const errors: Error[] = []
    let forced = false
    let tracker = this.tracker
    try {
      tracker ??= await this.ensureTracker()
      await tracker.sample()
    } catch (error) {
      errors.push(toError(error))
    }

    // Graceful close is attempted even if process snapshot initialization itself failed. Without a
    // verified tracker we report cleanup as unsafe and retain the sandbox rather than killing by PID/name.
    if (!this.exitResult) {
      try {
        await withTimeout(
          this.app.close(),
          15_000,
          'Playwright could not close Electron gracefully within 15s',
        )
      } catch (error) {
        errors.push(toError(error))
      }
    }

    if (!tracker) {
      if (!this.exitResult) {
        await withTimeout(this.exitPromise, 2_000, 'Electron root process remained alive after app.close()')
      }
      throw combineErrors('Electron exited without a verified process-tree audit', [
        ...errors,
        new Error('Process-tree cleanup requires a verified root PID and creation time'),
      ])
    }

    try {
      const exit = this.exitResult
        ? this.exitResult
        : await withTimeout(this.exitPromise, 2_000, 'Electron root process remained alive after app.close()')
      await tracker.waitForExit(PROCESS_EXIT_TIMEOUT_MS)
      await tracker.stopSampling()
      return { exit, errors, forced }
    } catch (error) {
      errors.push(toError(error))
    }

    forced = true
    await tracker.forceTerminate()
    const exit = this.exitResult
      ? this.exitResult
      : await withTimeout(
          this.exitPromise,
          PROCESS_EXIT_TIMEOUT_MS,
          'Forced Electron termination did not exit root PID',
        )
    await tracker.waitForExit(PROCESS_EXIT_TIMEOUT_MS)
    return { exit, errors, forced }
  }
}

export const test = base.extend<ElectronFixtures>({
  // Playwright requires the first fixture argument to be an object destructuring pattern.
  // eslint-disable-next-line no-empty-pattern
  electronHarness: async ({}, provide, testInfo) => {
    const projectRoot = path.resolve(testInfo.config.rootDir, '..', '..')
    const mainEntry = path.join(projectRoot, 'out', 'main', 'index.mjs')
    await access(mainEntry, fsConstants.R_OK).catch(() => {
      throw new Error(`Electron entry is missing: ${mainEntry}. Run pnpm build before pnpm test:e2e.`)
    })

    const sandboxPath = await mkdtemp(path.join(tmpdir(), 'fluxplayer-e2e-'))
    let app: ElectronApplication | undefined
    let controller: ElectronProcessController | undefined
    let cleanupVerified = false
    const lifecycleErrors: Error[] = []

    try {
      const isolatedDirs = [
        path.join(sandboxPath, 'appdata', 'roaming'),
        path.join(sandboxPath, 'appdata', 'local'),
        path.join(sandboxPath, 'home'),
        path.join(sandboxPath, 'temp'),
        path.join(sandboxPath, 'xdg', 'config'),
        path.join(sandboxPath, 'xdg', 'cache'),
        path.join(sandboxPath, 'chromium-user-data'),
        testInfo.outputPath('electron-artifacts'),
      ]
      await Promise.all(isolatedDirs.map((directory) => mkdir(directory, { recursive: true })))

      app = await electron.launch({
        args: [`--user-data-dir=${path.join(sandboxPath, 'chromium-user-data')}`, mainEntry],
        artifactsDir: testInfo.outputPath('electron-artifacts'),
        cwd: projectRoot,
        env: environmentWithIsolatedPaths(sandboxPath),
        timeout: 30_000,
      })

      // Everything after a successful launch is inside this error-capturing lifecycle. Even a failed
      // route/init-script/window assertion reaches verified process-tree shutdown before sandbox removal.
      const networkViolations: string[] = []
      const rendererCrashes: string[] = []
      let networkGuardInstalled = false
      let rendererWatchInstalled = false

      try {
        controller = new ElectronProcessController(app)
        await controller.initialize()

        await app.context().route('**/*', (route) => guardNetworkRequest(route, networkViolations))
        networkGuardInstalled = true

        const watchedPages = new WeakSet<Page>()
        const watchRenderer = (rendererPage: Page): void => {
          if (watchedPages.has(rendererPage)) return
          watchedPages.add(rendererPage)
          rendererPage.on('crash', () => rendererCrashes.push(rendererPage.url() || '[unknown renderer]'))
        }
        app.on('window', watchRenderer)
        rendererWatchInstalled = true
        for (const rendererPage of app.windows()) watchRenderer(rendererPage)

        // The player owns a detached `new Audio()` element. Instrument the constructor before app code so
        // the E2E can assert the real element rather than mocking HTMLMediaElement.play().
        await app.context().addInitScript(() => {
          // A stale pre-M6 preference must not be able to disable the always-on visual stage.
          try {
            localStorage.setItem('fluxplayer-visual-enabled-v1', '0')
          } catch {
            // A transient opaque origin before the local page loads may not expose storage.
          }

          const NativeAudio = window.Audio
          const trackedAudio: HTMLAudioElement[] = []
          Object.defineProperty(globalThis, '__fluxE2EAudioElements', {
            configurable: true,
            value: trackedAudio,
          })
          const InstrumentedAudio = function (src?: string): HTMLAudioElement {
            const audio = new NativeAudio(src)
            trackedAudio.push(audio)
            return audio
          } as unknown as typeof Audio
          Object.setPrototypeOf(InstrumentedAudio, NativeAudio)
          InstrumentedAudio.prototype = NativeAudio.prototype
          window.Audio = InstrumentedAudio
        })

        const page = await app.firstWindow({ timeout: 30_000 })
        watchRenderer(page)
        await page.waitForLoadState('domcontentloaded')

        const audioInstrumented = await page.evaluate(() =>
          Array.isArray(
            (globalThis as typeof globalThis & { __fluxE2EAudioElements?: unknown }).__fluxE2EAudioElements,
          ),
        )
        if (!audioInstrumented) await page.reload({ waitUntil: 'domcontentloaded' })
        await page.locator('#root').waitFor({ state: 'attached' })

        const electronPaths = await app.evaluate(({ app: electronApp }) => ({
          userData: electronApp.getPath('userData'),
          sessionData: electronApp.getPath('sessionData'),
          temp: electronApp.getPath('temp'),
        }))
        for (const [name, electronPath] of Object.entries(electronPaths)) {
          expect(
            isPathInside(sandboxPath, electronPath),
            `Electron ${name} path must stay in E2E sandbox: ${electronPath}`,
          ).toBe(true)
        }

        const harness: ElectronHarness = {
          app,
          page,
          rendererCrashes,
          sandboxPath,
          waitForExit: (timeoutMs) => controller!.waitForExit(timeoutMs),
          close: () => controller!.close(),
        }
        await provide(harness)
      } catch (error) {
        lifecycleErrors.push(toError(error))
      }

      try {
        controller ??= new ElectronProcessController(app)
        const outcome = await controller.shutdown()
        cleanupVerified = true
        lifecycleErrors.push(...outcome.errors)
        if (outcome.forced) {
          lifecycleErrors.push(new Error('Electron required forced termination of its verified process tree'))
        }

        if (networkGuardInstalled) {
          try {
            expect(
              networkViolations,
              'renderer requests must be local or served by the explicit in-memory fixture',
            ).toEqual([])
          } catch (error) {
            lifecycleErrors.push(toError(error))
          }
        }
        if (rendererWatchInstalled) {
          try {
            expect(rendererCrashes, 'renderer process must not crash').toEqual([])
          } catch (error) {
            lifecycleErrors.push(toError(error))
          }
        }
        try {
          expect(outcome.exit.signal, 'Electron must exit normally, not from a signal').toBeNull()
          expect(outcome.exit.code, 'Electron must exit with code 0').toBe(0)
        } catch (error) {
          lifecycleErrors.push(toError(error))
        }
      } catch (error) {
        lifecycleErrors.push(toError(error))
      }

      if (cleanupVerified) {
        try {
          await rm(sandboxPath, { recursive: true, force: true })
        } catch (error) {
          lifecycleErrors.push(toError(error))
        }
      }
    } finally {
      if (!app) {
        await rm(sandboxPath, { recursive: true, force: true })
      } else if (!cleanupVerified) {
        // A teardown assertion must not prevent a second, idempotent verified cleanup attempt.
        try {
          controller ??= new ElectronProcessController(app)
          const outcome = await controller.shutdown()
          cleanupVerified = true
          lifecycleErrors.push(...outcome.errors)
          if (outcome.forced) {
            lifecycleErrors.push(new Error('Emergency cleanup required forced process-tree termination'))
          }
          await rm(sandboxPath, { recursive: true, force: true })
        } catch (error) {
          lifecycleErrors.push(toError(error))
        }
      }
    }

    if (lifecycleErrors.length > 0) throw combineErrors('Electron E2E lifecycle failed', lifecycleErrors)
  },
})

export { expect }

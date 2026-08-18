import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'

if (process.platform !== 'win32') process.exit(0)

const root = path.resolve(import.meta.dirname, '..')
const source = path.join(root, 'native', 'wallpaper-engine-helper', 'Program.cs')
const outputDirectory = path.join(root, 'resources', 'native', 'win-x64')
const output = path.join(outputDirectory, 'FluxPlayer.WallpaperEngine.Helper.exe')
const frameworkRoot = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64')
const compilers = fs
  .readdirSync(frameworkRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^v\d/i.test(entry.name))
  .map((entry) => path.join(frameworkRoot, entry.name, 'csc.exe'))
  .filter((candidate) => fs.existsSync(candidate))
  .sort()

const compiler = compilers.at(-1)
if (!compiler) throw new Error('Windows .NET Framework x64 csc.exe was not found')

fs.mkdirSync(outputDirectory, { recursive: true })
execFileSync(
  compiler,
  [
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/optimize+',
    `/out:${output}`,
    '/reference:System.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    source,
  ],
  { stdio: 'inherit', windowsHide: true },
)
const digest = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex')
fs.writeFileSync(`${output}.sha256`, `${digest}\n`, 'ascii')
console.log(`[native] built ${path.relative(root, output)} (${digest.slice(0, 12)})`)

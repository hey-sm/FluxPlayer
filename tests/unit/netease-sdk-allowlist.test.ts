import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NCM_ENDPOINT_ALLOWLIST, ncm } from '@server/providers/netease/sdk'

const projectFile = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')

const expectedEndpoints = [
  'login_status',
  'user_account',
  'cloudsearch',
  'song_detail',
  'song_url_v1',
  'song_url',
  'lyric_new',
  'lyric',
  'user_playlist',
  'likelist',
  'playlist_track_all',
  'playlist_detail',
  'logout',
] as const

describe('Netease SDK endpoint allowlist', () => {
  it('exposes exactly the product endpoint surface at runtime', () => {
    expect(NCM_ENDPOINT_ALLOWLIST).toEqual(expectedEndpoints)
    expect(Object.keys(ncm)).toEqual(expectedEndpoints)
    expect(Object.isFrozen(NCM_ENDPOINT_ALLOWLIST)).toBe(true)
    expect('server' in ncm).toBe(false)
  })

  it('uses only literal deep imports and never loads the package root or scans endpoint directories', () => {
    const source = projectFile('src/server/providers/netease/sdk.ts')
    const imports = Array.from(source.matchAll(/import\(['"]([^'"]+)['"]\)/g), (match) => match[1])
    const endpointImports = imports.filter((specifier) =>
      specifier.startsWith('NeteaseCloudMusicApi/module/'),
    )

    expect(imports).toContain('NeteaseCloudMusicApi/util/request.js')
    expect(endpointImports).toEqual(expectedEndpoints.map((name) => `NeteaseCloudMusicApi/module/${name}.js`))
    expect(new Set(endpointImports).size).toBe(expectedEndpoints.length)
    expect(imports).not.toContain('NeteaseCloudMusicApi')
    expect(source).not.toMatch(/from\s+['"]NeteaseCloudMusicApi['"]|require\(['"]NeteaseCloudMusicApi['"]\)/)
    expect(source).not.toMatch(
      /readdir|opendir|glob|fast-glob|import\.meta\.glob|require\.context|modulePath|endpointPath/i,
    )
    expect(source).not.toMatch(/import\(\s*[^'"\s]/)
  })

  it('keeps the SDK version exact so the audited deep-import ABI cannot drift', () => {
    const packageJson = JSON.parse(projectFile('package.json')) as {
      devDependencies?: Record<string, string>
      dependencies?: Record<string, string>
    }
    const version =
      packageJson.dependencies?.NeteaseCloudMusicApi ?? packageJson.devDependencies?.NeteaseCloudMusicApi

    expect(version).toBe('4.32.0')
    expect(version).not.toMatch(/^[~^*]|\s|workspace:|latest/)
  })
})

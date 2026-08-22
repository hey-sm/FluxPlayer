import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const projectFile = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')

describe('desktop release configuration', () => {
  it('defines native installers for Windows and macOS', () => {
    const manifest = JSON.parse(projectFile('package.json')) as {
      desktopName?: string
      scripts: Record<string, string>
    }
    const builder = projectFile('electron-builder.yml')

    expect(manifest.scripts['build:win']).toContain('electron-builder --win')
    expect(manifest.scripts['build:mac']).toContain('electron-builder --mac')
    expect(builder).not.toContain('signAndEditExecutable: false')
    expect(builder).toContain('signtoolOptions:')
    expect(builder).toContain('signingHashAlgorithms: [sha256]')
    expect(builder).toContain('electronLanguages: [zh-CN, zh-TW, en-US]')
    expect(builder).not.toMatch(/^\s+license:\s/m)
    expect(builder).toContain('hardenedRuntime: true')
    expect(builder).toContain('notarize: true')
    expect(existsSync(new URL('../../resources/entitlements.mac.plist', import.meta.url))).toBe(true)
  })

  it('builds every main push and publishes signed version tags', () => {
    const workflow = projectFile('.github/workflows/release.yml')

    expect(workflow).toContain("tags: ['v*']")
    expect(workflow).toContain('WINDOWS_CERTIFICATE_BASE64')
    expect(workflow).toContain('MACOS_CERTIFICATE_BASE64')
    expect(workflow).toContain('APPLE_API_KEY_BASE64')
    expect(workflow).toContain('Get-AuthenticodeSignature')
    expect(workflow).toContain('spctl --assess')
    expect(workflow).toContain('gh release create')
    expect(workflow).toContain('SHA256SUMS.txt')
    expect(workflow).not.toMatch(/^    env:\r?\n      WINDOWS_CERTIFICATE_BASE64:/m)
  })
})

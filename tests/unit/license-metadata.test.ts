import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const projectFile = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')

describe('license metadata', () => {
  it('publishes FluxPlayer under MIT while preserving third-party exceptions', () => {
    const manifest = JSON.parse(projectFile('package.json')) as { license?: string }
    const license = projectFile('LICENSE')
    const readme = projectFile('README.md')
    const notices = projectFile('THIRD_PARTY_NOTICES.md')

    expect(manifest.license).toBe('MIT')
    expect(license).toContain('MIT License')
    expect(license).toContain('Copyright (c) 2026 FluxPlayer contributors')
    expect(readme).toContain('[MIT License](LICENSE)')
    expect(readme).toContain('[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)')
    expect(notices).toContain('GreenSock Standard "no charge" License')
    expect(notices).toContain('MIT + Commons Clause License Condition v1.0')
    expect(notices).toContain('HTML-Light-Demo')
  })
})

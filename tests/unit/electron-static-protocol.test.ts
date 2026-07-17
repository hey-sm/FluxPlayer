import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PRODUCTION_CSP } from '../../src/main/protocols/constants'
import { handleAppAssetRequest, resolveAppAssetPath } from '../../src/main/protocols/static-assets'

const temporaryDirectories: string[] = []

function temporaryStaticRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxplayer-static-'))
  temporaryDirectories.push(root)
  fs.mkdirSync(path.join(root, 'assets'))
  fs.writeFileSync(path.join(root, 'index.html'), '<main>FluxPlayer</main>')
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'export const ok = true')
  return root
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('flux://app static protocol', () => {
  it('resolves only files inside the renderer root', () => {
    const root = temporaryStaticRoot()

    expect(resolveAppAssetPath(root, 'flux://app/index.html')).toBe(path.join(root, 'index.html'))
    expect(resolveAppAssetPath(root, 'flux://other/index.html')).toBeNull()
    expect(resolveAppAssetPath(root, 'https://app/index.html')).toBeNull()
    expect(resolveAppAssetPath(root, 'flux://app/%2e%2e%2fsecret.txt')).toBeNull()
    expect(resolveAppAssetPath(root, 'flux://app/%5c..%5csecret.txt')).toBeNull()
    expect(resolveAppAssetPath(root, 'flux://app/assets/')).toBeNull()
  })

  it('serves static bytes with a production CSP and immutable asset caching', async () => {
    const root = temporaryStaticRoot()
    const response = await handleAppAssetRequest(root, new Request('flux://app/assets/app.js'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(response.headers.get('content-security-policy')).toBe(PRODUCTION_CSP)
    expect(response.headers.get('cache-control')).toContain('immutable')
    expect(await response.text()).toContain('export const ok')
  })

  it('rejects unsupported methods, directories, and missing files', async () => {
    const root = temporaryStaticRoot()

    expect(
      (await handleAppAssetRequest(root, new Request('flux://app/index.html', { method: 'POST' }))).status,
    ).toBe(405)
    expect((await handleAppAssetRequest(root, new Request('flux://app/missing.js'))).status).toBe(404)
    expect((await handleAppAssetRequest(root, new Request('flux://app/assets/'))).status).toBe(404)
  })

  it('rejects encoded traversal, backslash, NUL, malformed encoding, and authority spoofing', () => {
    const root = temporaryStaticRoot()
    const rejected = [
      'flux://app/%2e%2e%2fsecret.txt',
      'flux://app/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
      'flux://app/%5c..%5csecret.txt',
      'flux://app/%00index.html',
      'flux://app/%E0%A4%A',
      'flux://user@app/index.html',
      'flux://app:443/index.html',
      'flux://app.evil.example/index.html',
    ]

    for (const url of rejected) expect(resolveAppAssetPath(root, url), url).toBeNull()
  })

  it('applies the restrictive CSP and cache policy to HTML and HEAD responses', async () => {
    const root = temporaryStaticRoot()
    const response = await handleAppAssetRequest(
      root,
      new Request('flux://app/index.html', { method: 'HEAD' }),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('content-security-policy')).toBe(PRODUCTION_CSP)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin')

    const directives = new Set(PRODUCTION_CSP.split('; '))
    for (const directive of [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'none'",
      "script-src 'self'",
      "connect-src 'self'",
    ]) {
      expect(directives.has(directive), directive).toBe(true)
    }
    expect(PRODUCTION_CSP).not.toMatch(/https?:|localhost|127\.0\.0\.1|\*/)
  })
})

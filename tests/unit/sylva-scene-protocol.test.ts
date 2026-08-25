import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { handleSylvaRequest } from '../../src/main/protocols/sylva/scene-handler'
import threeRuntimeRaw from '../../src/main/protocols/sylva/three-r149.min.js?raw'

describe('flux-sylva:// raw import parity', () => {
  it('the ?raw three.js import matches the file byte-for-byte and has no </script>', () => {
    const file = readFileSync(
      new URL('../../src/main/protocols/sylva/three-r149.min.js', import.meta.url),
      'utf8',
    )
    expect(threeRuntimeRaw).toBe(file)
    expect((threeRuntimeRaw.match(/<\/script>/g) || []).length).toBe(0)
  })
})

describe('flux-sylva:// scene protocol', () => {
  it('serves the isolated scene document with a scoped permissive CSP', async () => {
    const response = handleSylvaRequest(new Request('flux-sylva://scene'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    // The scene needs inline scripts (bundled Three.js r149 + ~4000 lines of
    // scene code), so its own CSP allows them — but nothing else. The app CSP
    // keeps script-src strict; only this document relaxes it. It must also
    // allow the app origin as a frame-ancestor (it is meant to be framed).
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("script-src 'unsafe-inline'")
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain('frame-ancestors flux://app http://localhost:*')

    const doc = await response.text()
    // Landing-page markup dropped, scene-only markup kept.
    expect(doc).toContain('<canvas id="scene"')
    expect(doc).toContain('<div class="stage" id="stage"')
    // The external runtime reference is replaced by an inlined bundle.
    expect(doc).not.toContain('inner-green-assets/three.min.js')
    expect(doc).toContain('<script data-flux-sylva-three-runtime>')
    // Pointer bridge that re-dispatches postMessage into PointerEvents.
    expect(doc).toContain('sylva-pointer')
    expect(doc).toContain('#4a4d44')
  })

  it('serves the same memoised document bytes on repeated requests', async () => {
    const first = await handleSylvaRequest(new Request('flux-sylva://scene')).text()
    const second = await handleSylvaRequest(new Request('flux-sylva://scene')).text()
    expect(second).toBe(first)
  })

  it('inlines the full Three.js runtime intact (no $-interpolation corruption)', async () => {
    // Regression guard: String.prototype.replace treats `$'`, `` $` ``, `$&`,
    // `$1`… in the replacement string as special patterns. The Three.js bundle
    // contains a literal `$'` (in `.replace('WC', ah) + '$'`), so building the
    // document via replace() truncated the runtime and spliced in the rest of
    // the document, leaving the scene script broken. The builder must splice
    // verbatim.
    const doc = await handleSylvaRequest(new Request('flux-sylva://scene')).text()
    const open = '<script data-flux-sylva-three-runtime>'
    const start = doc.indexOf(open)
    expect(start).toBeGreaterThan(-1)
    const bodyStart = start + open.length
    const close = doc.indexOf('</script>', bodyStart)
    expect(close).toBeGreaterThan(bodyStart)
    const runtime = doc.slice(bodyStart, close)
    // The runtime must be the complete Three.js bundle, not a truncated one.
    expect(runtime).toBe(threeRuntimeRaw)
    expect(runtime.endsWith('(t.sRGBEncoding = ht))\n})\n')).toBe(true)
    // And nothing </script>-shaped leaks inside it.
    expect(runtime.includes('</script>')).toBe(false)
  })

  it('rejects non-GET methods, spoofed hosts, and paths under the scheme', () => {
    expect(handleSylvaRequest(new Request('flux-sylva://scene', { method: 'POST' })).status).toBe(405)
    expect(handleSylvaRequest(new Request('flux-sylva://evil/scene')).status).toBe(404)
    expect(handleSylvaRequest(new Request('flux-sylva://scene/extra')).status).toBe(404)
    expect(handleSylvaRequest(new Request('flux-sylva://scene?x=1')).status).toBe(404)
    expect(handleSylvaRequest(new Request('https://scene/')).status).toBe(404)
  })
})

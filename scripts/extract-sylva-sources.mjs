// One-off extraction: pulls the canonical Sylva "inner-green-3d.html" scene
// and its bundled three.min.js (r149) out of the docs source bundle
// (docs/LivingGreen.ts) into plain asset files the main process imports with
// Vite `?raw` and serves via the flux-sylva:// protocol. Re-run only if the docs
// bundle is refreshed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const docsPath = 'D:/dev/FluxPlayer/docs/LivingGreen.ts'
const outDir = 'D:/dev/FluxPlayer/src/main/protocols/sylva'
const src = readFileSync(docsPath, 'utf8')

function block(headerRe, fenceLang) {
  const h = src.match(headerRe)
  if (!h) throw new Error(`header not found: ${headerRe}`)
  const after = src.slice(h.index + h[0].length)
  // The docs bundle uses CRLF line endings, so tolerate either \n or \r\n.
  const open = '```' + fenceLang + '\n'
  let i = after.indexOf(open)
  if (i < 0) {
    const openCrlf = '```' + fenceLang + '\r\n'
    i = after.indexOf(openCrlf)
    if (i < 0) throw new Error(`open fence not found for ${fenceLang}`)
  }
  const bodyStart = i + open.length
  let close = after.indexOf('\n```', bodyStart)
  if (close < 0) {
    close = after.indexOf('\r\n```', bodyStart)
    if (close < 0) throw new Error('close fence not found')
  }
  return after.slice(bodyStart, close)
}

const html = block(/### `src\/shaders\/sylva-living-world\/sources\/inner-green-3d\.html`/, 'html')
const js = block(
  /### `src\/shaders\/sylva-living-world\/sources\/inner-green-assets\/three\.min\.js`/,
  'javascript',
)

mkdirSync(outDir, { recursive: true })
writeFileSync(`${outDir}/scene-source.html`, html, 'utf8')
writeFileSync(`${outDir}/three-r149.min.js`, js, 'utf8')
console.log('html bytes', Buffer.byteLength(html), 'lines', html.split('\n').length)
console.log('js bytes', Buffer.byteLength(js), 'starts', js.slice(0, 80))

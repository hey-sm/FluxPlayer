import { Text } from 'three-text'

// Relative to document base so it resolves same-origin in both modes: dev serves from
// http://localhost:5173/, prod from flux://app/. A cross-origin flux:// fetch is CSP/CORS-blocked.
const HB_WASM_URL = new URL('hb/hb.wasm', document.baseURI).href
const FONT_URL = new URL('fonts/NotoSansSC-VF.ttf', document.baseURI).href

let initPromise: Promise<ArrayBuffer> | null = null

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`加载失败 ${url}: ${response.status}`)
  return response.arrayBuffer()
}

/**
 * One-time HarfBuzz WASM + font bootstrap. The wasm buffer is fed to three-text
 * directly (setHarfBuzzBuffer) so glyph shaping never touches the network path,
 * and the resolved value is the font ArrayBuffer passed to every Text.create call.
 */
export function ensureLyricsFont(): Promise<ArrayBuffer> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    const [wasm, font] = await Promise.all([fetchArrayBuffer(HB_WASM_URL), fetchArrayBuffer(FONT_URL)])
    Text.setHarfBuzzBuffer(wasm)
    await Text.init()
    return font
  })().catch((error) => {
    initPromise = null
    throw error
  })
  return initPromise
}

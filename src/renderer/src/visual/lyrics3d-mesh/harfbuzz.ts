import { Text } from 'three-text'
import type { LyricsFontKey } from './fonts'

// Relative to document base so it resolves same-origin in both modes: dev serves from
// http://localhost:5173/, prod from flux://app/. A cross-origin flux:// fetch is CSP/CORS-blocked.
const HB_WASM_URL = new URL('hb/hb.wasm', document.baseURI).href

let initPromise: Promise<void> | null = null
const faceRequests = new Map<LyricsFontKey, Promise<ArrayBuffer>>()

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`加载失败 ${url}: ${response.status}`)
  return response.arrayBuffer()
}

/**
 * One-time HarfBuzz WASM bootstrap. The wasm buffer is fed to three-text directly
 * (setHarfBuzzBuffer) so glyph shaping never touches the network path.
 */
export function ensureHarfBuzz(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    Text.setHarfBuzzBuffer(await fetchArrayBuffer(HB_WASM_URL))
    await Text.init()
  })().catch((error) => {
    initPromise = null
    throw error
  })
  return initPromise
}

/**
 * Fetch one system face by logical key through the main-process `flux-font://` protocol.
 * Each key is fetched at most once; a failure clears the entry so a later line can retry.
 */
export function fetchFace(key: LyricsFontKey): Promise<ArrayBuffer> {
  const existing = faceRequests.get(key)
  if (existing) return existing
  const request = fetchArrayBuffer(`flux-font://face/${key}`).catch((error) => {
    faceRequests.delete(key)
    throw error
  })
  faceRequests.set(key, request)
  return request
}

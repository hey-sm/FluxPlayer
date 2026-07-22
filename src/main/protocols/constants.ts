export const APP_SCHEME = 'flux'
export const MEDIA_SCHEME = 'flux-media'
export const APP_ORIGIN = `${APP_SCHEME}://app`
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`

export const PRODUCTION_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: flux-media: flux-background:",
  "media-src 'self' blob: flux-media: flux-background:",
  "connect-src 'self' flux:",
  "worker-src 'self' blob:",
].join('; ')

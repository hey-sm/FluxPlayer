export const APP_SCHEME = 'flux'
export const MEDIA_SCHEME = 'flux-media'
export const FONT_SCHEME = 'flux-font'
export const WALLPAPER_ENGINE_SCHEME = 'flux-wallpaper'
export const SYLVA_SCHEME = 'flux-sylva'
export const APP_ORIGIN = `${APP_SCHEME}://app`
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`

export const PRODUCTION_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  'frame-src flux-sylva:',
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: flux-media: flux-background: flux-wallpaper:",
  "media-src 'self' blob: flux-media: flux-background: flux-wallpaper:",
  "connect-src 'self' flux: flux-font:",
  "worker-src 'self' blob:",
].join('; ')

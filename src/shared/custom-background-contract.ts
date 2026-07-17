export const CUSTOM_BACKGROUND_VERSION = 1 as const
export const CUSTOM_BACKGROUND_SCHEME = 'flux-background' as const

export type CustomBackgroundKind = 'image' | 'video'
export type CustomBackgroundSource = 'file' | 'wallpaper-engine'

export interface CustomBackground {
  version: typeof CUSTOM_BACKGROUND_VERSION
  id: string
  kind: CustomBackgroundKind
  source: CustomBackgroundSource
  name: string
  mimeType: string
  url: string
  updatedAt: string
}

export interface WallpaperEngineProject {
  id: string
  title: string
  kind: 'video'
  previewUrl: string
}

export interface CustomBackgroundResult {
  ok: boolean
  background: CustomBackground | null
  canceled?: boolean
  error?: string
}

export interface WallpaperEngineScanResult {
  ok: boolean
  projects: WallpaperEngineProject[]
  error?: string
}

export interface WallpaperEngineImportRequest {
  projectId: string
}

export const IMAGE_BACKGROUND_EXTENSIONS = Object.freeze([
  '.avif',
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.webp',
] as const)
export const VIDEO_BACKGROUND_EXTENSIONS = Object.freeze(['.m4v', '.mov', '.mp4', '.webm'] as const)

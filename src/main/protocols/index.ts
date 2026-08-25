import { net, protocol } from 'electron'
import type { CustomBackgroundService } from '../background/custom-background'
import type { WallpaperEngineLibrary } from '../background/wallpaper-engine-library'
import { CUSTOM_BACKGROUND_SCHEME } from '@shared/custom-background-contract'
import { APP_SCHEME, FONT_SCHEME, MEDIA_SCHEME, SYLVA_SCHEME, WALLPAPER_ENGINE_SCHEME } from './constants'
import { handleAppAssetRequest } from './static-assets'
import { AudioHandleStore, handleMediaRequest } from './media'
import { handleFontRequest } from './fonts'
import { handleSylvaRequest } from './sylva/scene-handler'

export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
    {
      scheme: CUSTOM_BACKGROUND_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
    {
      scheme: FONT_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
    {
      scheme: WALLPAPER_ENGINE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
    {
      // The Sylva scene iframe loads from this scheme. It must be standard +
      // secure so the browser treats it as a normal origin (CSP, same-origin
      // policy) rather than a blob-like context.
      scheme: SYLVA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ])
}

export interface ProtocolRegistrationOptions {
  staticRoot: string
  audioHandles: AudioHandleStore
  customBackgroundService: CustomBackgroundService
  wallpaperEngineLibrary: WallpaperEngineLibrary
}

export function registerProtocolHandlers(options: ProtocolRegistrationOptions): void {
  protocol.handle(APP_SCHEME, (request) => handleAppAssetRequest(options.staticRoot, request))
  protocol.handle(MEDIA_SCHEME, (request) =>
    handleMediaRequest(options.audioHandles, request, (input, init) => net.fetch(input, init)),
  )
  protocol.handle(CUSTOM_BACKGROUND_SCHEME, (request) => {
    const fileUrl = options.customBackgroundService.resolveRequestUrl(request.url)
    return fileUrl ? net.fetch(fileUrl) : new Response('Not found', { status: 404 })
  })
  protocol.handle(WALLPAPER_ENGINE_SCHEME, (request) => options.wallpaperEngineLibrary.mediaResponse(request))
  protocol.handle(FONT_SCHEME, (request) => handleFontRequest(request))
  protocol.handle(SYLVA_SCHEME, (request) => handleSylvaRequest(request))
}

export { APP_ENTRY_URL, APP_ORIGIN } from './constants'
export { AudioHandleStore } from './media'

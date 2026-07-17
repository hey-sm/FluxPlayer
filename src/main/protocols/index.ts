import { net, protocol } from 'electron'
import type { CustomBackgroundService } from '../background/custom-background'
import { CUSTOM_BACKGROUND_SCHEME } from '@shared/custom-background-contract'
import { APP_SCHEME, MEDIA_SCHEME } from './constants'
import { handleAppAssetRequest } from './static-assets'
import { AudioHandleStore, handleMediaRequest } from './media'

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
  ])
}

export interface ProtocolRegistrationOptions {
  staticRoot: string
  audioHandles: AudioHandleStore
  customBackgroundService: CustomBackgroundService
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
}

export { APP_ENTRY_URL, APP_ORIGIN } from './constants'
export { AudioHandleStore } from './media'
